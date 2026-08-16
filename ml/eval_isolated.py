"""학습된 단어 인식 체크포인트를 **다른 데이터셋**으로 평가한다.

    python -m ml.eval_isolated --checkpoint <runs>/iso-v1/best.pt \
        --data ~/sbdata/ksl-valpart

용도: 공식 배포의 Validation 파트(ksl-valpart)는 학습에 한 번도 쓰이지 않은
**완전 별도 평가셋**이다. 학습 러너의 val 수치(같은 파트 안에서 수어자 분리)보다
한 단계 엄격한, 발표에 쓸 최종 수치를 여기서 뽑는다.

주의
- 체크포인트의 어휘로 평가한다. 평가셋에만 있는 글로스는 대상에서 빠지므로
  **커버리지(평가된 세그먼트 비율)를 반드시 함께 보고**한다. 커버리지를 빼고
  정확도만 말하면 부풀린 수치가 된다.
- prepare를 돌리지 않은 index는 split 필드가 없어 전부 "train"으로 읽힌다.
  기본 --split train은 그래서 "인덱스 전체"라는 뜻이 된다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.signbridge.dataset import IsolatedGlossDataset, read_index  # noqa: E402
from ml.signbridge.models import IsolatedSignClassifier, ModelConfig  # noqa: E402
from ml.signbridge.vocab import GlossVocab, normalize_gloss  # noqa: E402
from ml.train_isolated import collate  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="단어 인식 체크포인트 교차 평가")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True, help="index.jsonl이 있는 디렉터리")
    parser.add_argument("--split", default="train", help="prepare 미실행 인덱스는 train=전체")
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--merge-variants", action="store_true")
    args = parser.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    itos = ckpt["vocab"]
    # GlossVocab은 [BLANK, UNK, *glosses]로 구성된다 — 앞 두 개를 떼고 복원한다.
    vocab = GlossVocab(itos[2:])
    assert vocab.itos == itos, "체크포인트 어휘 복원이 어긋났습니다"

    config = ModelConfig(**ckpt["config"])
    model = IsolatedSignClassifier(config)
    model.load_state_dict(ckpt["model"])
    device = torch.device(args.device)
    model.to(device).eval()

    dataset = IsolatedGlossDataset(
        args.data / "index.jsonl",
        vocab,
        split=args.split,
        merge_variants=args.merge_variants,
        zero_depth=bool(config.extra.get("zero_depth", False)),
        seq_len=int(config.extra.get("seq_len", 32)),
    )

    # 커버리지: 평가셋의 전체 글로스 구간 중 체크포인트 어휘에 있는 비율.
    total_segments = 0
    for record in read_index(args.data / "index.jsonl", args.split):
        for entry in record.glosses:
            if normalize_gloss(entry.get("gloss", ""), args.merge_variants):
                total_segments += 1
    coverage = len(dataset) / total_segments if total_segments else 0.0

    print(
        f"[eval] {args.checkpoint} (epoch {ckpt.get('epoch')}, 학습 시 val_top1 "
        f"{ckpt.get('val_top1', float('nan')):.4f})"
    )
    print(
        f"[eval] 평가셋 {args.data} — 세그먼트 {len(dataset):,}/{total_segments:,}"
        f" (어휘 커버리지 {coverage:.1%})"
    )

    loader = torch.utils.data.DataLoader(
        dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.workers,
        collate_fn=collate,
    )

    top1 = top5 = seen = 0
    with torch.no_grad():
        for feats, labels in loader:
            feats = feats.to(device)
            logits = model(feats).cpu()
            ranks = logits.topk(5, dim=-1).indices
            top1 += int((ranks[:, 0] == labels).sum())
            top5 += int((ranks == labels[:, None]).any(dim=-1).sum())
            seen += len(labels)
            if seen % (args.batch_size * 50) < args.batch_size:
                print(f"  {seen:,}/{len(dataset):,}", flush=True)

    result = {
        "checkpoint": str(args.checkpoint),
        "checkpoint_epoch": ckpt.get("epoch"),
        "data": str(args.data),
        "segments_evaluated": seen,
        "segments_total": total_segments,
        "vocab_coverage": round(coverage, 4),
        "top1": round(top1 / seen, 4) if seen else None,
        "top5": round(top5 / seen, 4) if seen else None,
    }
    print(f"\n[eval] top1 {result['top1']:.4f} · top5 {result['top5']:.4f} (커버리지 {coverage:.1%})")
    out = args.checkpoint.parent / f"eval_{args.data.name}.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[eval] 결과 → {out}")


if __name__ == "__main__":
    main()
