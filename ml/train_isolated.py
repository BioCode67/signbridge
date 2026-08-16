"""글로스(단어) 단위 수어 인식 학습.

실시간 자막의 1차 목표다. AI Hub가 글로스마다 start/end 타임코드를 주므로, 문장 클립을
잘라 단어 표본을 만들면 별도 라벨링 없이 수만 개 학습 표본이 나온다.

    # 데이터 없이 GPU/환경 점검 (KOREN 워크스페이스 첫 실행 시 권장)
    python -m ml.train_isolated --synthetic --epochs 3

    # 실제 학습
    python -m ml.train_isolated --data /data/signbridge/ksl-mp \
        --out runs/isolated-v1 --epochs 60 --batch-size 128

체크포인트에는 모델 가중치와 함께 **특징 설정(zero_depth·seq_len)과 어휘**가 같이 저장된다.
추론 측에서 이 값을 잘못 맞추면 조용히 성능만 떨어지므로, 내보내기 스크립트가 이 정보를
그대로 읽어 쓴다.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.signbridge.augment import AugmentConfig
from ml.signbridge.dataset import IsolatedGlossDataset
from ml.signbridge.features import FEATURE_DIM, SEQ_LEN
from ml.signbridge.metrics import AverageMeter, topk_accuracy
from ml.signbridge.models import IsolatedSignClassifier, ModelConfig, count_parameters
from ml.signbridge.vocab import GlossVocab


class SyntheticDataset(torch.utils.data.Dataset):
    """클래스별 인공 궤적. **환경 점검 전용** — 실제 수어와 무관하다.

    데이터 준비 전에 "GPU·드라이버·학습 루프·저장·내보내기"가 도는지 확인하기 위한 것으로,
    여기서 나온 정확도는 어떤 의미도 없다.
    """

    def __init__(
        self, num_classes: int, samples_per_class: int, seq_len: int, sample_seed: int = 0
    ):
        self.seq_len = seq_len
        self.num_classes = num_classes
        # 클래스 서명은 학습·검증이 **공유**해야 한다(서명이 다르면 서로 다른 문제를 푸는
        # 셈이라 검증 정확도가 우연 수준에 머문다). 분할 차이는 sample_seed로만 준다.
        rng = np.random.default_rng(20240517)
        self.base = rng.normal(0, 0.6, size=(num_classes, FEATURE_DIM)).astype(np.float32)
        self.direction = rng.normal(0, 0.5, size=(num_classes, FEATURE_DIM)).astype(np.float32)
        self.labels = np.repeat(np.arange(num_classes), samples_per_class)
        self.seed = sample_seed

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, index: int):
        label = int(self.labels[index])
        rng = np.random.default_rng(self.seed * 7919 + index)
        phase = rng.uniform(0, 2 * math.pi)
        steps = np.linspace(0, 2 * math.pi, self.seq_len, dtype=np.float32)
        wave = np.sin(steps + phase)[:, None]
        sequence = self.base[label][None, :] + wave * self.direction[label][None, :]
        sequence += rng.normal(0, 0.08, size=sequence.shape).astype(np.float32)
        return sequence.astype(np.float32), label


def build_loaders(args, vocab: GlossVocab):
    if args.synthetic:
        train_set = SyntheticDataset(args.synthetic_classes, 48, args.seq_len, sample_seed=0)
        val_set = SyntheticDataset(args.synthetic_classes, 12, args.seq_len, sample_seed=99)
        return train_set, val_set

    augment = AugmentConfig(
        rotate_deg=args.aug_rotate,
        scale=args.aug_scale,
        shift=args.aug_shift,
        noise=args.aug_noise,
        joint_dropout=args.aug_joint_dropout,
        mirror_prob=args.aug_mirror,
        enabled=not args.no_augment,
    )
    common = dict(
        index_path=args.data / "index.jsonl",
        vocab=vocab,
        root=args.data,
        seq_len=args.seq_len,
        merge_variants=args.merge_variants,
        zero_depth=args.zero_depth,
        cache_size=args.cache_size,
    )
    train_set = IsolatedGlossDataset(split="train", augment=augment, seed=args.seed, **common)
    val_set = IsolatedGlossDataset(split="val", augment=None, **common)
    return train_set, val_set


def collate(batch):
    sequences = np.stack([item[0] for item in batch])
    labels = np.asarray([item[1] for item in batch], dtype=np.int64)
    return torch.from_numpy(sequences), torch.from_numpy(labels)


def cosine_schedule(step: int, total: int, warmup: int) -> float:
    if step < warmup:
        return (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, total - warmup)
    return 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))


@torch.no_grad()
def evaluate(model, loader, device, criterion, amp_dtype) -> dict:
    model.eval()
    loss_meter, top1_meter, top5_meter = AverageMeter(), AverageMeter(), AverageMeter()
    for sequences, labels in loader:
        sequences = sequences.to(device, non_blocking=True)
        labels = labels.to(device, non_blocking=True)
        with torch.autocast(device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
            logits = model(sequences)
            loss = criterion(logits, labels)
        logits = logits.float()
        loss_meter.update(loss.item(), len(labels))
        top1_meter.update(topk_accuracy(logits, labels, 1), len(labels))
        top5_meter.update(topk_accuracy(logits, labels, 5), len(labels))
    return {
        "loss": loss_meter.average,
        "top1": top1_meter.average,
        "top5": top5_meter.average,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="글로스 단위 수어 인식 학습")
    parser.add_argument("--data", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=Path("runs/isolated"))
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=0.05)
    parser.add_argument("--warmup-ratio", type=float, default=0.05)
    parser.add_argument("--label-smoothing", type=float, default=0.1)
    parser.add_argument("--seq-len", type=int, default=SEQ_LEN)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--amp", choices=["bf16", "fp16", "off"], default="bf16")
    parser.add_argument("--cache-size", type=int, default=256)

    parser.add_argument("--d-model", type=int, default=256)
    parser.add_argument("--layers", type=int, default=4)
    parser.add_argument("--heads", type=int, default=8)
    parser.add_argument("--ff-dim", type=int, default=512)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--no-velocity", action="store_true")

    parser.add_argument("--zero-depth", action="store_true", help="z 채널 제거(2D 소스용)")
    parser.add_argument("--merge-variants", action="store_true")
    parser.add_argument("--no-augment", action="store_true")
    parser.add_argument("--aug-rotate", type=float, default=12.0)
    parser.add_argument("--aug-scale", type=float, default=0.15)
    parser.add_argument("--aug-shift", type=float, default=0.12)
    parser.add_argument("--aug-noise", type=float, default=0.01)
    parser.add_argument("--aug-joint-dropout", type=float, default=0.05)
    parser.add_argument("--aug-mirror", type=float, default=0.0)

    parser.add_argument("--synthetic", action="store_true", help="데이터 없이 환경 점검")
    parser.add_argument("--synthetic-classes", type=int, default=30)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device(args.device)
    args.out.mkdir(parents=True, exist_ok=True)

    if args.synthetic:
        vocab = GlossVocab([f"합성{i}" for i in range(args.synthetic_classes)])
        num_classes = args.synthetic_classes
    else:
        if args.data is None:
            raise SystemExit("--data 또는 --synthetic 중 하나가 필요합니다.")
        vocab = GlossVocab.load(args.data / "vocab.json")
        num_classes = len(vocab)

    train_set, val_set = build_loaders(args, vocab)
    if len(train_set) == 0:
        raise SystemExit("학습 표본이 0개입니다. prepare.py의 --min-count를 낮춰 보세요.")

    print(f"[train] 학습 {len(train_set)} / 검증 {len(val_set)} 표본, 클래스 {num_classes}개")

    pin = device.type == "cuda"
    train_loader = DataLoader(
        train_set,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        collate_fn=collate,
        pin_memory=pin,
        drop_last=len(train_set) > args.batch_size,
        persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(
        val_set,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=max(1, args.workers // 2),
        collate_fn=collate,
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
        conv_stride=1,
        num_classes=num_classes,
        extra={"seq_len": args.seq_len, "zero_depth": args.zero_depth, "task": "isolated"},
    )
    model = IsolatedSignClassifier(config).to(device)
    print(f"[train] 파라미터 {count_parameters(model) / 1e6:.2f}M")

    amp_dtype = None
    if device.type == "cuda" and args.amp != "off":
        amp_dtype = torch.bfloat16 if args.amp == "bf16" else torch.float16
    scaler = torch.amp.GradScaler(enabled=amp_dtype is torch.float16)

    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=args.weight_decay, betas=(0.9, 0.98)
    )
    total_steps = max(1, args.epochs * len(train_loader))
    warmup_steps = int(args.warmup_ratio * total_steps)

    history_path = args.out / "history.jsonl"
    best_top1 = -1.0
    step = 0

    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_meter, acc_meter = AverageMeter(), AverageMeter()
        started = time.time()

        for sequences, labels in train_loader:
            sequences = sequences.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)

            learning_rate = args.lr * cosine_schedule(step, total_steps, warmup_steps)
            for group in optimizer.param_groups:
                group["lr"] = learning_rate

            with torch.autocast(device.type, dtype=amp_dtype, enabled=amp_dtype is not None):
                logits = model(sequences)
                loss = criterion(logits, labels)

            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()

            loss_meter.update(loss.item(), len(labels))
            acc_meter.update(topk_accuracy(logits.float(), labels, 1), len(labels))
            step += 1

        metrics = evaluate(model, val_loader, device, criterion, amp_dtype)
        elapsed = time.time() - started
        print(
            f"[{epoch:3d}/{args.epochs}] "
            f"loss {loss_meter.average:.4f} acc {acc_meter.average:.3f} | "
            f"val loss {metrics['loss']:.4f} top1 {metrics['top1']:.3f} top5 {metrics['top5']:.3f} "
            f"| lr {learning_rate:.2e} | {elapsed:.1f}s",
            flush=True,
        )
        with open(history_path, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "epoch": epoch,
                        "train_loss": loss_meter.average,
                        "train_top1": acc_meter.average,
                        **{f"val_{k}": v for k, v in metrics.items()},
                        "lr": learning_rate,
                        "seconds": elapsed,
                    }
                )
                + "\n"
            )

        if metrics["top1"] > best_top1:
            best_top1 = metrics["top1"]
            torch.save(
                {
                    "model": model.state_dict(),
                    "config": config.__dict__,
                    "vocab": vocab.itos,
                    "epoch": epoch,
                    "val_top1": best_top1,
                },
                args.out / "best.pt",
            )

    print(f"[train] 최고 검증 top1 = {best_top1:.4f} → {args.out / 'best.pt'}")
    (args.out / "summary.json").write_text(
        json.dumps(
            {"best_val_top1": best_top1, "num_classes": num_classes, "args": vars(args)},
            ensure_ascii=False,
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
