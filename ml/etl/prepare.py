"""index.jsonl → 학습/검증/평가 분할 + 글로스 사전 + 통계.

    python -m ml.etl.prepare --data /data/signbridge/ksl-mp --min-count 5

분할 정책 (`--split-by`)
  signer  수어자 단위로 겹치지 않게 나눈다. **기본이자 정직한 기준.** 같은 사람이 학습과
          평가에 함께 있으면 모델이 사람의 버릇을 외워 정확도가 부풀려진다. 실제 서비스는
          처음 보는 사용자를 상대하므로 이 수치가 진짜 성능이다.
  clip    클립 ID 해시로 나눈다. signer 정보가 없을 때의 차선책.
  sentence 같은 한국어 문장이 여러 수어자에게 반복 촬영된 데이터에서, 문장 단위로 나눈다.
          (수어자 일반화가 아니라 문장 일반화를 보고 싶을 때.)

사전은 **학습 분할에서만** 집계한다(검증 어휘가 새어 들어가지 않게).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.vocab import GlossVocab, normalize_gloss  # noqa: E402


def stable_bucket(key: str, buckets: int = 1000) -> int:
    """재현 가능한 해시 버킷(파이썬 hash는 실행마다 달라져 쓸 수 없다)."""
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % buckets


def assign_splits(records: list[dict], split_by: str, val_ratio: float, test_ratio: float) -> None:
    if split_by == "signer":
        keys = [r.get("signer") or "" for r in records]
        if not any(keys):
            print("[prepare] ⚠️ signer 정보가 없어 clip 해시 분할로 대체합니다.")
            split_by = "clip"
    if split_by == "sentence":
        keys = [r.get("korean_text") or r["id"] for r in records]
    elif split_by == "clip":
        keys = [r["id"] for r in records]
    else:
        keys = [r.get("signer") or r["id"] for r in records]

    val_cut = int(val_ratio * 1000)
    test_cut = val_cut + int(test_ratio * 1000)
    for record, key in zip(records, keys):
        bucket = stable_bucket(key)
        if bucket < val_cut:
            record["split"] = "val"
        elif bucket < test_cut:
            record["split"] = "test"
        else:
            record["split"] = "train"


def main() -> None:
    parser = argparse.ArgumentParser(description="분할 + 글로스 사전 생성")
    parser.add_argument("--data", type=Path, required=True, help="index.jsonl이 있는 디렉터리")
    parser.add_argument("--split-by", choices=["signer", "clip", "sentence"], default="signer")
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--min-count", type=int, default=5, help="이보다 드문 글로스는 제외")
    parser.add_argument("--max-vocab", type=int, default=0, help="0=제한 없음")
    parser.add_argument("--merge-variants", action="store_true", help="오늘1/오늘2를 한 클래스로")
    parser.add_argument(
        "--keep-labels",
        type=Path,
        default=None,
        help="JSON 배열 파일. 여기 있는 글로스만 남긴다(재난 30개 어휘 등).",
    )
    parser.add_argument(
        "--exclude-augmented",
        action="store_true",
        help="AI 증강 문장(augment=true)을 제외한다. 실제 발송 재난문자만 쓰고 싶을 때",
    )
    parser.add_argument(
        "--only-remote",
        action="store_true",
        help="비대면 촬영(filmed_in_studio=false)만 쓴다. 웹캠 환경에 더 가깝다",
    )
    args = parser.parse_args()

    index_path = args.data / "index.jsonl"
    records = [json.loads(line) for line in index_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not records:
        raise SystemExit(f"레코드가 없습니다: {index_path}")

    # 필터는 **레코드를 지우지 않는다.** split="excluded"로 표시만 하고 index.jsonl에는
    # 전부 남긴다. 지워 버리면 다른 조건으로 다시 돌릴 때 데이터가 영영 사라지고
    # (ETL을 통째로 다시 돌려야 한다), 필터를 연달아 적용하면 결과가 누적돼 버린다.
    kept: list[dict] = []
    excluded: list[dict] = []
    for record in records:
        drop = (args.exclude_augmented and record.get("augment", False)) or (
            args.only_remote and record.get("filmed_in_studio", True)
        )
        (excluded if drop else kept).append(record)

    if excluded:
        print(f"[prepare] 필터로 제외(split=excluded): {len(excluded)}개 / 사용 {len(kept)}개")
    if not kept:
        raise SystemExit("필터를 적용하니 남은 클립이 0개입니다.")

    for record in excluded:
        record["split"] = "excluded"
    assign_splits(kept, args.split_by, args.val_ratio, args.test_ratio)

    for split in ("train", "val", "test"):
        if not any(r["split"] == split for r in kept):
            print(
                f"[prepare] ⚠️ '{split}' 분할이 비었습니다. 수어자 수가 적으면 signer 분할이"
                " 한쪽으로 쏠립니다 — --split-by clip 을 고려하세요."
            )
    records = kept + excluded

    counts = Counter[str]()
    per_split = Counter[str]()
    for record in records:
        per_split[record["split"]] += 1
        if record["split"] != "train":
            continue
        for entry in record.get("glosses", []):
            gloss = normalize_gloss(entry.get("gloss", ""), args.merge_variants)
            if gloss:
                counts[gloss] += 1

    if args.keep_labels:
        allowed = {
            normalize_gloss(g, args.merge_variants)
            for g in json.loads(args.keep_labels.read_text(encoding="utf-8"))
        }
        counts = Counter({g: c for g, c in counts.items() if g in allowed})
        print(f"[prepare] 어휘 화이트리스트 적용: {len(allowed)}개 중 {len(counts)}개 관측")

    vocab = GlossVocab.build(
        counts, min_count=args.min_count, max_size=args.max_vocab or None
    )
    vocab.save(args.data / "vocab.json")

    with open(index_path, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    kept = len(vocab) - 2  # blank, unk 제외
    total_segments = sum(counts[g] for g in vocab.itos[2:])
    coverage = total_segments / max(1, sum(counts.values()))

    stats = {
        "clips": len(records),
        "splits": dict(per_split),
        "gloss_types_observed": len(counts),
        "gloss_types_kept": kept,
        "train_segments_kept": total_segments,
        "token_coverage": round(coverage, 4),
        "min_count": args.min_count,
        "split_by": args.split_by,
        "merge_variants": args.merge_variants,
    }
    (args.data / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"\n[prepare] 상위 20개 글로스: {[g for g, _ in counts.most_common(20)]}")
    if kept < 20:
        print("[prepare] ⚠️ 어휘가 너무 적습니다. --min-count를 낮추거나 데이터를 더 넣으세요.")


if __name__ == "__main__":
    main()
