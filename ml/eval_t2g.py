#!/usr/bin/env python3
"""학습된 소형 번역 모델을 **사람 정답과 견준다.**

    python -m ml.eval_t2g --checkpoint ~/sbruns/t2gs-v1 --data ~/sbdata/script --limit 800

**왜 필요한가.** 지금까지 번역 품질을 재는 수단이 "낱말 표현률"뿐이었다. 그건
"몇 %가 수어로 나갔나"만 잰다 — **맞게 나갔는지도, 어순이 맞는지도 모른다.**
여기서는 사람 번역가가 만든 글로스열을 정답으로 두고 셋을 잰다:

    BLEU-4      낱말과 **이어짐**까지 맞는가 (기계번역의 표준 지표)
    글로스 F1   어느 낱말을 냈는가 (순서는 안 봄)
    어순 상관   맞힌 낱말들의 **순서**가 정답과 같은가 (켄달 타우)

같은 문장으로 통계 사전도 재서(scripts/eval_dict_on.mjs) 나란히 놓는다.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter
from pathlib import Path

import torch

from ml.train_t2g_small import BOS, EOS, PAD, SmallT2G, Vocab, load_pairs, syllables


def ngrams(seq: list[str], n: int) -> Counter:
    return Counter(tuple(seq[i:i + n]) for i in range(len(seq) - n + 1))


def corpus_bleu(preds: list[list[str]], golds: list[list[str]], nmax: int = 4) -> float:
    """코퍼스 BLEU-4. 짧게 내서 점수를 올리는 것을 길이 벌점으로 막는다."""
    match = [0] * nmax
    total = [0] * nmax
    plen = glen = 0
    for p, g in zip(preds, golds):
        plen += len(p)
        glen += len(g)
        for n in range(1, nmax + 1):
            pc, gc = ngrams(p, n), ngrams(g, n)
            total[n - 1] += max(0, len(p) - n + 1)
            match[n - 1] += sum(min(c, gc[k]) for k, c in pc.items())
    if min(total) == 0 or min(match) == 0:
        return 0.0
    logs = sum(math.log(match[i] / total[i]) for i in range(nmax)) / nmax
    bp = 1.0 if plen > glen else math.exp(1 - glen / max(1, plen))
    return 100 * bp * math.exp(logs)


def gloss_f1(preds: list[list[str]], golds: list[list[str]]) -> tuple[float, float, float]:
    tp = fp = fn = 0
    for p, g in zip(preds, golds):
        pc, gc = Counter(p), Counter(g)
        inter = sum((pc & gc).values())
        tp += inter
        fp += len(p) - inter
        fn += len(g) - inter
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-9, prec + rec)
    return 100 * prec, 100 * rec, 100 * f1


def kendall_order(preds: list[list[str]], golds: list[list[str]]) -> float:
    """맞힌 낱말들의 순서 일치. 정답에서의 자리와 예측에서의 자리를 견준다."""
    conc = disc = 0
    for p, g in zip(preds, golds):
        pos_g = {w: i for i, w in enumerate(g)}
        seq = [pos_g[w] for w in p if w in pos_g]
        for i in range(len(seq)):
            for j in range(i + 1, len(seq)):
                if seq[j] > seq[i]:
                    conc += 1
                elif seq[j] < seq[i]:
                    disc += 1
    tot = conc + disc
    return 100 * (conc - disc) / tot if tot else 0.0


@torch.no_grad()
def greedy(model: SmallT2G, sv: Vocab, tv: Vocab, text: str, dev: str,
           max_src: int, max_tgt: int) -> list[str]:
    ids = sv.encode(syllables(text))[:max_src]
    if not ids:
        return []
    src = torch.tensor([ids], device=dev)
    memory, mem_mask = model.encode(src)
    out = [BOS]
    for _ in range(max_tgt):
        tgt = torch.tensor([out], device=dev)
        logits = model.decode(memory, mem_mask, tgt)[0, -1]
        logits[PAD] = logits[BOS] = -1e9
        nxt = int(logits.argmax())
        if nxt == EOS:
            break
        out.append(nxt)
    return [tv.itos[i] for i in out[1:]]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--data", type=Path, nargs="+", required=True)
    ap.add_argument("--limit", type=int, default=800)
    ap.add_argument("--dump", type=Path, default=Path("scripts/t2g_eval_set.json"))
    a = ap.parse_args()

    ck = torch.load(a.checkpoint / "best.pt", map_location="cpu", weights_only=False)
    cfg = ck["cfg"]
    vocab = json.loads((a.checkpoint / "vocab.json").read_text(encoding="utf-8"))
    sv, tv = Vocab([]), Vocab([])
    sv.itos, tv.itos = vocab["src"], vocab["tgt"]
    sv.stoi = {s: i for i, s in enumerate(sv.itos)}
    tv.stoi = {s: i for i, s in enumerate(tv.itos)}

    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = SmallT2G(cfg["n_src"], cfg["n_tgt"], d=cfg["d"], enc=cfg["enc"], dec=cfg["dec"])
    model.load_state_dict(ck["model"])
    model.to(dev).eval()

    # **학습 때와 똑같이 나눈다**(seed 1234) — 검증 문장을 그대로 다시 쓴다.
    pairs = load_pairs(list(a.data))
    rng = random.Random(1234)
    rng.shuffle(pairs)
    n_val = max(1, int(len(pairs) * 0.03))
    val = pairs[:n_val][: a.limit]
    print(f"[eval] 검증 문장 {len(val):,}")

    preds, golds, rows = [], [], []
    for text, gold in val:
        pred = greedy(model, sv, tv, text, dev, cfg["max_src"], cfg["max_tgt"])
        preds.append(pred)
        golds.append(gold)
        rows.append({"text": text, "gold": gold, "nn": pred})

    bleu = corpus_bleu(preds, golds)
    prec, rec, f1 = gloss_f1(preds, golds)
    tau = kendall_order(preds, golds)
    print(f"\n[eval] 학습 모델 (t2gs)")
    print(f"  BLEU-4      {bleu:.1f}")
    print(f"  글로스 F1   {f1:.1f}  (정밀도 {prec:.1f} · 재현율 {rec:.1f})")
    print(f"  어순 상관   {tau:.1f}")
    print(f"  평균 길이   예측 {sum(len(p) for p in preds) / len(preds):.1f} / "
          f"정답 {sum(len(g) for g in golds) / len(golds):.1f}")

    a.dump.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print(f"\n[eval] 같은 문장으로 사전도 재려면 → {a.dump}")
    print("  node --experimental-strip-types --import ./scripts/ts-register.mjs "
          "scripts/eval_dict_on.mjs")
    print("\n[eval] 보기 (앞 3개)")
    for r in rows[:3]:
        print(f"  원문: {r['text'][:60]}")
        print(f"  사람: {' '.join(r['gold'][:14])}")
        print(f"  모델: {' '.join(r['nn'][:14])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
