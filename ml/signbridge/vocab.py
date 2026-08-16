"""글로스 어휘 사전.

AI Hub 글로스는 동형 이의어를 숫자 접미로 구분한다(`오늘1`, `버스1`, `때2`).
접미를 남길지 합칠지는 **정확도와 표현력의 교환**이다.
  - `merge_variants=True`  → `오늘1`·`오늘2`가 한 클래스. 클래스당 표본이 늘어 인식률이
    오르지만, 서로 다른 수형이 한 클래스에 섞여 아바타 재생 품질이 떨어진다.
  - `merge_variants=False` → 원본 유지. 문장 복원·아바타 연동에 유리하나 롱테일이 심하다.
기본값은 False(원본 유지)이고, 저빈도 글로스는 `min_count`로 잘라낸다.

`#`(비수지 강조 등)·공백 같은 표기 흔들림은 정규화 단계에서 정리한다.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

BLANK = "<blank>"  # CTC blank — 반드시 인덱스 0.
UNK = "<unk>"

_VARIANT_RE = re.compile(r"\d+$")
_DECORATION_RE = re.compile(r"[#*~]+")


def normalize_gloss(gloss: str, merge_variants: bool = False) -> str:
    """글로스 표기를 정규화한다."""
    text = _DECORATION_RE.sub("", gloss).strip()
    text = re.sub(r"\s+", "", text)
    if merge_variants:
        text = _VARIANT_RE.sub("", text)
    return text


class GlossVocab:
    """글로스 ↔ 정수 인덱스. 인덱스 0은 CTC blank로 예약한다."""

    def __init__(self, glosses: list[str]):
        self.itos: list[str] = [BLANK, UNK, *glosses]
        self.stoi: dict[str, int] = {g: i for i, g in enumerate(self.itos)}

    def __len__(self) -> int:
        return len(self.itos)

    @property
    def blank_id(self) -> int:
        return 0

    @property
    def unk_id(self) -> int:
        return 1

    def encode(self, glosses: list[str]) -> list[int]:
        return [self.stoi.get(g, self.unk_id) for g in glosses]

    def decode(self, ids: list[int]) -> list[str]:
        return [self.itos[i] for i in ids if 0 <= i < len(self.itos)]

    @classmethod
    def build(
        cls,
        counter: Counter[str],
        min_count: int = 5,
        max_size: int | None = None,
    ) -> "GlossVocab":
        items = [(g, c) for g, c in counter.items() if c >= min_count and g]
        # 빈도 내림차순, 동률은 사전순 — 재현 가능한 인덱스를 위해.
        items.sort(key=lambda kv: (-kv[1], kv[0]))
        if max_size is not None:
            items = items[:max_size]
        return cls([g for g, _ in items])

    def save(self, path: str | Path) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"itos": self.itos}, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @classmethod
    def load(cls, path: str | Path) -> "GlossVocab":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        vocab = cls([])
        vocab.itos = data["itos"]
        vocab.stoi = {g: i for i, g in enumerate(vocab.itos)}
        return vocab
