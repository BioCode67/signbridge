"""연속 수어 → 글로스 시퀀스 학습 (CTC).

단어 단위 인식(`train_isolated.py`)의 다음 단계다. 실제 수어는 단어가 끊기지 않고
이어지며 경계가 모호한데, CTC는 **프레임 단위 정렬 라벨 없이** 입력 시퀀스와 출력
글로스 시퀀스만으로 학습된다. AI Hub 라벨에 글로스 순서가 있으므로 그대로 쓸 수 있다.

    python -m ml.train_ctc --data /data/signbridge/ksl-mp \
        --out runs/ctc-v1 --epochs 80 --batch-size 16

지표는 **WER(글로스 오류율)**이며 낮을수록 좋다. 참고로 공개 벤치마크(PHOENIX-14 등)에서
잘 훈련된 모델이 20% 안팎이므로, 초기 실험에서 60~80%가 나와도 정상이다. 여기서 나온
글로스 시퀀스를 `train_gloss2text.py`가 자연스러운 한국어 문장으로 복원한다.

메모: `--conv-stride 2`를 쓰면 시간축이 절반이 되어 학습이 빨라지지만, CTC는
**입력 길이 ≥ 라벨 길이**여야 하므로 짧은 클립에서 손실이 무한대가 될 수 있다.
이 스크립트는 그런 표본을 자동으로 건너뛰고 개수를 보고한다.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from ml.signbridge.augment import AugmentConfig
from ml.signbridge.dataset import ContinuousGlossDataset, collate_ctc
from ml.signbridge.features import FEATURE_DIM
from ml.signbridge.metrics import AverageMeter, ctc_greedy_decode, word_error_rate
from ml.signbridge.models import (
    ContinuousSignRecognizer,
    ModelConfig,
    count_parameters,
    make_padding_mask,
)
from ml.signbridge.vocab import GlossVocab
from ml.train_isolated import cosine_schedule


def split_targets(targets: torch.Tensor, lengths: torch.Tensor) -> list[list[int]]:
    """평탄화된 CTC 타깃을 표본별 리스트로 되돌린다."""
    out: list[list[int]] = []
    offset = 0
    for length in lengths.tolist():
        out.append(targets[offset : offset + length].tolist())
        offset += length
    return out


def compute_loss(model, batch, device, amp_dtype, blank_id: int):
    inputs = batch["inputs"].to(device, non_blocking=True)
    input_lengths = batch["input_lengths"].to(device)
    targets = batch["targets"].to(device)
    target_lengths = batch["target_lengths"].to(device)

    padding_mask = make_padding_mask(input_lengths, inputs.shape[1])
    with torch.autocast(device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
        logits = model(inputs, padding_mask)

    # CTC 손실은 fp32에서 계산한다(로그확률 누적이라 저정밀도에서 불안정하다).
    log_probs = F.log_softmax(logits.float(), dim=-1).transpose(0, 1)  # [T, B, C]
    output_lengths = model.encoder.output_lengths(input_lengths).clamp(max=log_probs.shape[0])

    # 입력이 라벨보다 짧은 표본은 CTC가 정의되지 않는다(무한대 손실의 주범).
    feasible = output_lengths >= target_lengths
    skipped = int((~feasible).sum())

    loss = F.ctc_loss(
        log_probs,
        targets,
        output_lengths,
        target_lengths,
        blank=blank_id,
        reduction="mean",
        zero_infinity=True,
    )
    return loss, logits, output_lengths, skipped


@torch.no_grad()
def evaluate(model, loader, device, amp_dtype, blank_id: int) -> dict:
    model.eval()
    loss_meter = AverageMeter()
    references: list[list[int]] = []
    hypotheses: list[list[int]] = []

    for batch in loader:
        loss, logits, output_lengths, _ = compute_loss(model, batch, device, amp_dtype, blank_id)
        loss_meter.update(loss.item(), len(batch["input_lengths"]))
        log_probs = F.log_softmax(logits.float(), dim=-1)
        hypotheses.extend(ctc_greedy_decode(log_probs, output_lengths, blank=blank_id))
        references.extend(split_targets(batch["targets"], batch["target_lengths"]))

    return {
        "loss": loss_meter.average,
        "wer": word_error_rate(references, hypotheses),
        "samples": len(references),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="연속 수어 인식 학습(CTC)")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("runs/ctc"))
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup-ratio", type=float, default=0.1)
    parser.add_argument("--max-frames", type=int, default=512)
    parser.add_argument("--frame-stride", type=int, default=1, help="입력 프레임 솎아내기")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--amp", choices=["bf16", "fp16", "off"], default="bf16")

    parser.add_argument("--d-model", type=int, default=256)
    parser.add_argument("--layers", type=int, default=6)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--ff-dim", type=int, default=1024)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--conv-stride", type=int, default=2)
    parser.add_argument("--no-velocity", action="store_true")

    parser.add_argument("--zero-depth", action="store_true")
    parser.add_argument("--merge-variants", action="store_true")
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--init-from", type=Path, default=None, help="isolated 체크포인트로 초기화")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device)
    args.out.mkdir(parents=True, exist_ok=True)

    vocab = GlossVocab.load(args.data / "vocab.json")
    augment = AugmentConfig(enabled=not args.no_augment)
    common = dict(
        index_path=args.data / "index.jsonl",
        vocab=vocab,
        root=args.data,
        max_frames=args.max_frames,
        stride=args.frame_stride,
        merge_variants=args.merge_variants,
        zero_depth=args.zero_depth,
    )
    train_set = ContinuousGlossDataset(split="train", augment=augment, seed=args.seed, **common)
    val_set = ContinuousGlossDataset(split="val", augment=None, **common)
    if len(train_set) == 0:
        raise SystemExit("학습 클립이 0개입니다.")
    print(f"[ctc] 학습 {len(train_set)} / 검증 {len(val_set)} 클립, 어휘 {len(vocab)}")

    pin = device.type == "cuda"
    train_loader = DataLoader(
        train_set,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        collate_fn=collate_ctc,
        pin_memory=pin,
        persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(
        val_set,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=max(1, args.workers // 2),
        collate_fn=collate_ctc,
        pin_memory=pin,
    )

    config = ModelConfig(
        feature_dim=FEATURE_DIM,
        d_model=args.d_model,
        num_layers=args.layers,
        num_heads=args.heads,
        ff_dim=args.ff_dim,
        dropout=args.dropout,
        use_velocity=not args.no_velocity,
        conv_stride=args.conv_stride,
        num_classes=len(vocab),
        extra={"zero_depth": args.zero_depth, "task": "ctc", "max_frames": args.max_frames},
    )
    model = ContinuousSignRecognizer(config).to(device)

    if args.init_from is not None:
        # 단어 인식으로 학습된 인코더를 그대로 물려받으면 수렴이 훨씬 빠르다(헤드는 새로).
        checkpoint = torch.load(args.init_from, map_location="cpu", weights_only=False)
        encoder_weights = {
            key[len("encoder.") :]: value
            for key, value in checkpoint["model"].items()
            if key.startswith("encoder.")
        }
        missing, unexpected = model.encoder.load_state_dict(encoder_weights, strict=False)
        print(f"[ctc] 인코더 사전학습 로드 (missing={len(missing)}, unexpected={len(unexpected)})")

    print(f"[ctc] 파라미터 {count_parameters(model) / 1e6:.2f}M")

    amp_dtype = None
    if device.type == "cuda" and args.amp != "off":
        amp_dtype = torch.bfloat16 if args.amp == "bf16" else torch.float16
    scaler = torch.amp.GradScaler(enabled=amp_dtype is torch.float16)

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay, betas=(0.9, 0.98)
    )
    total_steps = max(1, args.epochs * len(train_loader))
    warmup_steps = int(args.warmup_ratio * total_steps)

    best_wer = math.inf
    step = 0
    total_skipped = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_meter = AverageMeter()
        started = time.time()

        for batch in train_loader:
            learning_rate = args.lr * cosine_schedule(step, total_steps, warmup_steps)
            for group in optimizer.param_groups:
                group["lr"] = learning_rate

            loss, _, _, skipped = compute_loss(model, batch, device, amp_dtype, vocab.blank_id)
            total_skipped += skipped

            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(optimizer)
            scaler.update()

            loss_meter.update(loss.item(), len(batch["input_lengths"]))
            step += 1

        metrics = evaluate(model, val_loader, device, amp_dtype, vocab.blank_id)
        elapsed = time.time() - started
        print(
            f"[{epoch:3d}/{args.epochs}] loss {loss_meter.average:.4f} | "
            f"val loss {metrics['loss']:.4f} WER {metrics['wer']:.3f} | {elapsed:.1f}s",
            flush=True,
        )
        with open(args.out / "history.jsonl", "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "epoch": epoch,
                        "train_loss": loss_meter.average,
                        "val_loss": metrics["loss"],
                        "val_wer": metrics["wer"],
                        "seconds": elapsed,
                    }
                )
                + "\n"
            )

        if metrics["wer"] < best_wer:
            best_wer = metrics["wer"]
            torch.save(
                {
                    "model": model.state_dict(),
                    "config": config.__dict__,
                    "vocab": vocab.itos,
                    "epoch": epoch,
                    "val_wer": best_wer,
                },
                args.out / "best.pt",
            )

    if total_skipped:
        print(
            f"[ctc] ⚠️ 입력이 라벨보다 짧아 손실에서 제외된 표본 {total_skipped}건. "
            f"--conv-stride를 줄이거나 --max-frames를 늘리세요."
        )
    print(f"[ctc] 최저 검증 WER = {best_wer:.4f} → {args.out / 'best.pt'}")


if __name__ == "__main__":
    main()
