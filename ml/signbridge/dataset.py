"""학습용 데이터셋.

두 과제를 하나의 인덱스(`index.jsonl`)에서 파생시킨다.

  IsolatedGlossDataset  — 문장 클립을 글로스 타임코드로 잘라 **단어 단위** 분류 표본을
                          만든다. AI Hub가 글로스마다 start/end를 주기 때문에 별도
                          라벨링 없이 수만 개 표본이 공짜로 나온다.
  ContinuousGlossDataset — 문장 클립 전체 → 글로스 **시퀀스**(CTC 학습용).

`index.jsonl` 레코드(한 줄 = 한 클립):
    {"id": "...", "npz": "packs/xxx.npz", "fps": 30.0, "num_frames": 686,
     "korean_text": "...", "signer": "s07", "split": "train",
     "glosses": [{"gloss": "오늘1", "start": 1.401, "end": 2.244}, ...]}

메모리 전략: 팩은 클립당 수백 KB이므로 **LRU 캐시로 특징 행렬만** 들고 있는다.
AI Hub 전량(수십 GB)은 캐시를 끄고(`cache_size=0`) 워커 수를 늘리는 편이 낫다.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from torch.utils.data import Dataset

from .augment import AugmentConfig, augment_sequence, random_time_crop
from .features import FEATURE_DIM, SEQ_LEN, resample_sequence
from .pack import pack_to_features
from .vocab import GlossVocab, normalize_gloss

# 글로스 구간 앞뒤로 붙이는 여유(초). 수어는 전이 동작(transition)에 정보가 걸쳐 있어
# 타임코드를 딱 맞춰 자르면 시작·끝 수형이 잘린다.
SEGMENT_PADDING_SEC = 0.15
MIN_SEGMENT_FRAMES = 4


@dataclass
class ClipRecord:
    clip_id: str
    npz: str
    fps: float
    num_frames: int
    korean_text: str
    glosses: list[dict]
    signer: str = ""
    split: str = "train"


def read_index(path: str | Path, split: str | None = None) -> list[ClipRecord]:
    records: list[ClipRecord] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            raw = json.loads(line)
            record = ClipRecord(
                clip_id=raw["id"],
                npz=raw["npz"],
                fps=float(raw.get("fps", 30.0)),
                num_frames=int(raw.get("num_frames", 0)),
                korean_text=raw.get("korean_text", ""),
                glosses=raw.get("glosses", []),
                signer=raw.get("signer", ""),
                split=raw.get("split", "train"),
            )
            if split is None or record.split == split:
                records.append(record)
    return records


class _FeatureCache:
    """클립 특징 행렬 LRU 캐시. 워커 프로세스마다 독립적으로 존재한다."""

    def __init__(self, root: Path, zero_depth: bool, capacity: int):
        self.root = root
        self.zero_depth = zero_depth
        self.capacity = capacity
        self._store: OrderedDict[str, np.ndarray] = OrderedDict()

    def get(self, rel_path: str) -> np.ndarray:
        if self.capacity > 0 and rel_path in self._store:
            self._store.move_to_end(rel_path)
            return self._store[rel_path]

        feats, meta = pack_to_features(self.root / rel_path, zero_depth=self.zero_depth)
        valid = meta.get("valid_mask")
        if valid is not None and not bool(np.all(valid)):
            # 어깨 미검출 프레임은 브라우저에서도 버려지므로 학습에서도 뺀다.
            # 단, 전부 무효면(검출 실패 클립) 원본을 남겨 상위에서 걸러내게 한다.
            filtered = feats[np.asarray(valid, dtype=bool)]
            if len(filtered) >= MIN_SEGMENT_FRAMES:
                feats = filtered

        if self.capacity > 0:
            self._store[rel_path] = feats
            if len(self._store) > self.capacity:
                self._store.popitem(last=False)
        return feats


class IsolatedGlossDataset(Dataset):
    """글로스 단위 분류 데이터셋 → (SEQ_LEN, 155) 시퀀스 + 클래스 인덱스."""

    def __init__(
        self,
        index_path: str | Path,
        vocab: GlossVocab,
        split: str = "train",
        root: str | Path | None = None,
        seq_len: int = SEQ_LEN,
        augment: AugmentConfig | None = None,
        merge_variants: bool = False,
        zero_depth: bool = False,
        cache_size: int = 256,
        seed: int = 0,
    ):
        index_path = Path(index_path)
        self.root = Path(root) if root is not None else index_path.parent
        self.vocab = vocab
        self.seq_len = seq_len
        self.augment = augment
        self.merge_variants = merge_variants
        self.seed = seed
        self._cache = _FeatureCache(self.root, zero_depth, cache_size)

        self.samples: list[tuple[str, int, int, int]] = []  # (npz, start_f, end_f, label)
        for record in read_index(index_path, split):
            pad = SEGMENT_PADDING_SEC * record.fps
            for entry in record.glosses:
                gloss = normalize_gloss(entry.get("gloss", ""), merge_variants)
                if gloss not in vocab.stoi:
                    continue  # 저빈도로 잘려나간 글로스.
                start = int(max(0.0, entry["start"] * record.fps - pad))
                end = int(entry["end"] * record.fps + pad)
                if end - start < MIN_SEGMENT_FRAMES:
                    continue
                self.samples.append((record.npz, start, end, vocab.stoi[gloss]))

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[np.ndarray, int]:
        npz, start, end, label = self.samples[index]
        feats = self._cache.get(npz)
        segment = feats[start : min(end, len(feats))]
        if len(segment) < MIN_SEGMENT_FRAMES:
            segment = feats[max(0, start - MIN_SEGMENT_FRAMES) : start + MIN_SEGMENT_FRAMES]
        if len(segment) == 0:
            segment = np.zeros((1, FEATURE_DIM), dtype=np.float32)

        if self.augment is not None and self.augment.enabled:
            rng = np.random.default_rng((self.seed * 1_000_003 + index) & 0xFFFFFFFF)
            segment = random_time_crop(segment, self.augment, rng)
            segment = augment_sequence(segment, self.augment, rng)

        return resample_sequence(np.ascontiguousarray(segment), self.seq_len), label

    def label_counts(self) -> np.ndarray:
        counts = np.zeros(len(self.vocab), dtype=np.int64)
        for _, _, _, label in self.samples:
            counts[label] += 1
        return counts


class ContinuousGlossDataset(Dataset):
    """문장 클립 전체 → 글로스 시퀀스(CTC). 가변 길이라 `collate_ctc`로 묶는다."""

    def __init__(
        self,
        index_path: str | Path,
        vocab: GlossVocab,
        split: str = "train",
        root: str | Path | None = None,
        max_frames: int = 512,
        stride: int = 1,
        augment: AugmentConfig | None = None,
        merge_variants: bool = False,
        zero_depth: bool = False,
        cache_size: int = 64,
        seed: int = 0,
    ):
        index_path = Path(index_path)
        self.root = Path(root) if root is not None else index_path.parent
        self.vocab = vocab
        self.max_frames = max_frames
        self.stride = max(1, stride)
        self.augment = augment
        self.seed = seed
        self._cache = _FeatureCache(self.root, zero_depth, cache_size)

        self.records: list[tuple[str, list[int]]] = []
        for record in read_index(index_path, split):
            targets = [
                vocab.stoi[g]
                for g in (
                    normalize_gloss(e.get("gloss", ""), merge_variants) for e in record.glosses
                )
                if g in vocab.stoi
            ]
            if not targets:
                continue
            self.records.append((record.npz, targets))

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[np.ndarray, np.ndarray]:
        npz, targets = self.records[index]
        feats = self._cache.get(npz)
        if self.stride > 1:
            feats = feats[:: self.stride]

        if self.augment is not None and self.augment.enabled:
            rng = np.random.default_rng((self.seed * 1_000_003 + index) & 0xFFFFFFFF)
            feats = augment_sequence(feats, self.augment, rng)

        if len(feats) > self.max_frames:
            # CTC는 입력이 라벨보다 길어야 하므로, 자르지 않고 균일 리샘플로 압축한다.
            feats = resample_sequence(np.ascontiguousarray(feats), self.max_frames)
        return np.ascontiguousarray(feats, dtype=np.float32), np.asarray(targets, dtype=np.int64)


def collate_ctc(batch: list[tuple[np.ndarray, np.ndarray]]) -> dict:
    """가변 길이 배치 → 패딩 텐서 + 길이. CTC 손실에 필요한 형태."""
    import torch

    feats = [torch.from_numpy(f) for f, _ in batch]
    targets = [torch.from_numpy(t) for _, t in batch]
    input_lengths = torch.tensor([len(f) for f in feats], dtype=torch.long)
    target_lengths = torch.tensor([len(t) for t in targets], dtype=torch.long)

    max_len = int(input_lengths.max())
    padded = torch.zeros(len(feats), max_len, FEATURE_DIM, dtype=torch.float32)
    for i, item in enumerate(feats):
        padded[i, : len(item)] = item

    return {
        "inputs": padded,
        "input_lengths": input_lengths,
        "targets": torch.cat(targets) if targets else torch.zeros(0, dtype=torch.long),
        "target_lengths": target_lengths,
    }
