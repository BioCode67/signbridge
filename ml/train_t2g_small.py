#!/usr/bin/env python3
"""한국어 → 글로스열 **소형 seq2seq**. 브라우저에서 돌리려고 작게 만든다.

    python -m ml.train_t2g_small --data ~/sbdata/script --out ~/sbruns/t2gs-v1 --epochs 30

**왜 새로 학습하나.** 지금 앱이 쓰는 번역은 학습 모델이 아니라 공기빈도 통계
사전 + 규칙이다. 사전은 낱말을 바꿔 끼울 뿐이라, 사람 번역가가 쓰는 `자연1`
(원인 표지)처럼 **한국어에 대응 낱말이 없는 글로스**는 영영 만들지 못한다.

KoBART로 학습한 모델(t2g-v3)은 그걸 만들지만 브라우저에 올리기엔 크다
(int8로도 268MB). 어휘 3만 중 실제로 쓰는 것이 4,284개뿐인 일반 한국어 모델이라
대부분이 우리 과제와 무관한 무게다. 그래서 과제에 맞춰 작게 짓는다.

    입력  한국어 문장 → **음절 단위**(자모도 낱말도 아닌 글자)
          이유: 토크나이저 의존이 없고, 학습 때 못 본 지명·기관명에도 깨지지 않는다.
          한국어 상용 음절은 2~3천 개라 어휘가 작다.
    출력  글로스 하나 = 토큰 하나 (`시:9시`·`날짜:10월26일`도 통째로 한 토큰)
          이유: 글로스는 이미 이산 단위다. 서브워드로 쪼개면 잘못 조합될 여지만 는다.

크기 예상: d_model 384 · 인코더 4 · 디코더 4 · 출력층 묶기(weight tying)
    → 약 22M 파라미터 → fp32 88MB · **int8 약 22MB**
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
import unicodedata
from collections import Counter
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

PAD, BOS, EOS, UNK = 0, 1, 2, 3
SPECIALS = ["<pad>", "<s>", "</s>", "<unk>"]


# ── 데이터 ────────────────────────────────────────────────────────────
def load_pairs(paths: list[Path]) -> list[tuple[str, list[str]]]:
    """(한국어 문장, 글로스열) 쌍을 모은다. index.jsonl 형식 여러 개를 합칠 수 있다."""
    pairs: list[tuple[str, list[str]]] = []
    for p in paths:
        f = p / "index.jsonl" if p.is_dir() else p
        if not f.exists():
            print(f"  ⚠️ 없음: {f}")
            continue
        n0 = len(pairs)
        for line in f.open(encoding="utf-8"):
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            text = (o.get("korean_text") or "").strip()
            glosses = [g.get("gloss") for g in (o.get("glosses") or []) if g.get("gloss")]
            if text and glosses:
                pairs.append((text, glosses))
        print(f"  {f} → {len(pairs) - n0:,}쌍")
    return pairs


def syllables(text: str) -> list[str]:
    """음절 단위로 쪼갠다. 공백은 하나로 줄이고, 자모는 미리 합친다(NFC)."""
    return list(unicodedata.normalize("NFC", " ".join(text.split())))


class Vocab:
    def __init__(self, items: list[str]) -> None:
        self.itos = SPECIALS + items
        self.stoi = {s: i for i, s in enumerate(self.itos)}

    def __len__(self) -> int:
        return len(self.itos)

    def encode(self, seq: list[str]) -> list[int]:
        return [self.stoi.get(t, UNK) for t in seq]


class PairSet(Dataset):
    def __init__(self, pairs, src_vocab: Vocab, tgt_vocab: Vocab,
                 max_src: int, max_tgt: int) -> None:
        self.pairs, self.sv, self.tv = pairs, src_vocab, tgt_vocab
        self.max_src, self.max_tgt = max_src, max_tgt

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, i: int):
        text, glosses = self.pairs[i]
        src = self.sv.encode(syllables(text))[: self.max_src]
        tgt = self.tv.encode(glosses)[: self.max_tgt - 2]
        return torch.tensor(src), torch.tensor([BOS] + tgt + [EOS])


def collate(batch):
    srcs, tgts = zip(*batch)
    sm = max(len(s) for s in srcs)
    tm = max(len(t) for t in tgts)
    src = torch.full((len(batch), sm), PAD, dtype=torch.long)
    tgt = torch.full((len(batch), tm), PAD, dtype=torch.long)
    for i, (s, t) in enumerate(zip(srcs, tgts)):
        src[i, : len(s)] = s
        tgt[i, : len(t)] = t
    return src, tgt


# ── 모델 ──────────────────────────────────────────────────────────────
class PosEnc(nn.Module):
    """사인파 위치 인코딩 — 학습형과 달리 못 본 길이에도 외삽된다."""

    def __init__(self, d: int, maxlen: int = 512) -> None:
        super().__init__()
        pe = torch.zeros(maxlen, d)
        pos = torch.arange(maxlen).unsqueeze(1).float()
        div = torch.exp(torch.arange(0, d, 2).float() * (-math.log(10000.0) / d))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.size(1)]


class SmallT2G(nn.Module):
    def __init__(self, n_src: int, n_tgt: int, d: int = 384, heads: int = 6,
                 enc: int = 4, dec: int = 4, ff: int = 1536, dropout: float = 0.1) -> None:
        super().__init__()
        self.d = d
        self.src_emb = nn.Embedding(n_src, d, padding_idx=PAD)
        self.tgt_emb = nn.Embedding(n_tgt, d, padding_idx=PAD)
        self.pos = PosEnc(d)
        self.tr = nn.Transformer(
            d_model=d, nhead=heads, num_encoder_layers=enc, num_decoder_layers=dec,
            dim_feedforward=ff, dropout=dropout, batch_first=True, norm_first=True,
        )
        self.out = nn.Linear(d, n_tgt, bias=False)
        # **출력층을 디코더 임베딩과 묶는다** — 글로스 어휘가 1만을 넘어 이것만으로
        # 파라미터가 4~5M 줄고, 학습도 대체로 안정된다.
        self.out.weight = self.tgt_emb.weight

    def encode(self, src: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        mask = src == PAD
        h = self.pos(self.src_emb(src) * math.sqrt(self.d))
        return self.tr.encoder(h, src_key_padding_mask=mask), mask

    def decode(self, memory: torch.Tensor, mem_mask: torch.Tensor,
               tgt: torch.Tensor) -> torch.Tensor:
        causal = nn.Transformer.generate_square_subsequent_mask(tgt.size(1), device=tgt.device)
        h = self.pos(self.tgt_emb(tgt) * math.sqrt(self.d))
        h = self.tr.decoder(h, memory, tgt_mask=causal,
                            tgt_key_padding_mask=(tgt == PAD),
                            memory_key_padding_mask=mem_mask)
        return self.out(h)

    def forward(self, src: torch.Tensor, tgt_in: torch.Tensor) -> torch.Tensor:
        memory, mem_mask = self.encode(src)
        return self.decode(memory, mem_mask, tgt_in)


# ── 학습 ──────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, nargs="+", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=96)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--d-model", type=int, default=384)
    ap.add_argument("--enc", type=int, default=4)
    ap.add_argument("--dec", type=int, default=4)
    ap.add_argument("--max-src", type=int, default=160)
    ap.add_argument("--max-tgt", type=int, default=48)
    ap.add_argument("--min-gloss", type=int, default=2, help="이보다 드문 글로스는 <unk>")
    ap.add_argument("--val-frac", type=float, default=0.03)
    ap.add_argument("--label-smoothing", type=float, default=0.1)
    ap.add_argument("--workers", type=int, default=8)
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    print("[t2gs] 데이터")
    pairs = load_pairs(a.data)
    print(f"[t2gs] 총 {len(pairs):,}쌍")

    # 어휘 — 입력은 음절, 출력은 글로스 그대로.
    src_c: Counter = Counter()
    tgt_c: Counter = Counter()
    for text, glosses in pairs:
        src_c.update(syllables(text))
        tgt_c.update(glosses)
    src_items = [s for s, c in src_c.most_common() if c >= 2]
    tgt_items = [g for g, c in tgt_c.most_common() if c >= a.min_gloss]
    sv, tv = Vocab(src_items), Vocab(tgt_items)
    print(f"[t2gs] 어휘 — 음절 {len(sv):,} · 글로스 {len(tv):,}")

    rng = random.Random(1234)
    rng.shuffle(pairs)
    n_val = max(1, int(len(pairs) * a.val_frac))
    val_pairs, train_pairs = pairs[:n_val], pairs[n_val:]
    print(f"[t2gs] 학습 {len(train_pairs):,} · 검증 {len(val_pairs):,}")

    tr_ds = PairSet(train_pairs, sv, tv, a.max_src, a.max_tgt)
    va_ds = PairSet(val_pairs, sv, tv, a.max_src, a.max_tgt)
    tr = DataLoader(tr_ds, batch_size=a.batch, shuffle=True, collate_fn=collate,
                    num_workers=a.workers, pin_memory=True, drop_last=True,
                    persistent_workers=a.workers > 0)
    va = DataLoader(va_ds, batch_size=a.batch, shuffle=False, collate_fn=collate,
                    num_workers=max(2, a.workers // 2), pin_memory=True)

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = SmallT2G(len(sv), len(tv), d=a.d_model, enc=a.enc, dec=a.dec).to(dev)
    n_par = sum(p.numel() for p in model.parameters())
    print(f"[t2gs] 파라미터 {n_par:,} = {n_par / 1e6:.1f}M "
          f"(fp32 {n_par * 4 / 1e6:.0f}MB · int8 예상 {n_par / 1e6:.0f}MB)")

    crit = nn.CrossEntropyLoss(ignore_index=PAD, label_smoothing=a.label_smoothing)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=0.01, betas=(0.9, 0.98))
    steps = a.epochs * len(tr)
    warm = min(4000, steps // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min((s + 1) / max(1, warm), max(0.0, (steps - s) / max(1, steps - warm)))
    )
    scaler = torch.amp.GradScaler("cuda", enabled=dev == "cuda")

    (a.out / "vocab.json").write_text(json.dumps(
        {"src": sv.itos, "tgt": tv.itos}, ensure_ascii=False), encoding="utf-8")

    best = float("inf")
    for ep in range(1, a.epochs + 1):
        model.train()
        t0, tot, seen = time.time(), 0.0, 0
        for src, tgt in tr:
            src, tgt = src.to(dev, non_blocking=True), tgt.to(dev, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=dev == "cuda"):
                logits = model(src, tgt[:, :-1])
                loss = crit(logits.reshape(-1, logits.size(-1)), tgt[:, 1:].reshape(-1))
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item() * src.size(0)
            seen += src.size(0)

        model.eval()
        vtot, vseen, hit, cnt = 0.0, 0, 0, 0
        with torch.no_grad():
            for src, tgt in va:
                src, tgt = src.to(dev), tgt.to(dev)
                with torch.amp.autocast("cuda", enabled=dev == "cuda"):
                    logits = model(src, tgt[:, :-1])
                    loss = crit(logits.reshape(-1, logits.size(-1)), tgt[:, 1:].reshape(-1))
                vtot += loss.item() * src.size(0)
                vseen += src.size(0)
                pred = logits.argmax(-1)
                gold = tgt[:, 1:]
                m = gold != PAD
                hit += (pred[m] == gold[m]).sum().item()
                cnt += m.sum().item()
        vl = vtot / max(1, vseen)
        acc = hit / max(1, cnt)
        print(f"[{ep:3d}/{a.epochs}] train {tot / max(1, seen):.4f} | val {vl:.4f} "
              f"| 토큰 정확도 {acc:.4f} | {time.time() - t0:.0f}s", flush=True)
        if vl < best:
            best = vl
            torch.save({"model": model.state_dict(), "cfg": {
                "n_src": len(sv), "n_tgt": len(tv), "d": a.d_model,
                "enc": a.enc, "dec": a.dec, "max_src": a.max_src, "max_tgt": a.max_tgt,
            }}, a.out / "best.pt")
    print(f"[t2gs] 최저 검증 손실 {best:.4f} → {a.out / 'best.pt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
