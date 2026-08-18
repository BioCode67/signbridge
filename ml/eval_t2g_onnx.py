#!/usr/bin/env python3
"""내보낸 ONNX(fp32/int8)를 **같은 검증 문장으로** 재서 양자화 손실을 확인한다.

    python -m ml.eval_t2g_onnx --dirs ~/sbruns/t2g-f ~/sbruns/t2g-q \
        --set scripts/t2g_eval_set.json

**왜 필요한가.** int8은 크기를 1/4로 줄이지만 공짜가 아니다. 몇 문장 눈으로 봐서는
"비슷해 보인다"까지밖에 말 못 한다. 실제로 표본 6개에서 2개가 달랐는데, 그게
"조금 다른" 것인지 "무너진" 것인지는 지표로 재야 안다.

지표는 `ml/eval_t2g.py`와 **같은 계산**을 쓴다 — 다르면 비교가 성립하지 않는다.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

from ml.eval_t2g import corpus_bleu, gloss_f1, kendall_order
from ml.train_t2g_small import BOS, EOS, PAD, syllables


def load(dirpath: Path, threads: int = 1):
    opt = ort.SessionOptions()
    # 브라우저는 단일 스레드로 돈다 — 속도를 잴 때 조건을 맞춘다.
    opt.intra_op_num_threads = threads
    meta = json.loads((dirpath / "meta.json").read_text(encoding="utf-8"))
    enc = ort.InferenceSession(str(dirpath / "encoder.onnx"),
                               providers=["CPUExecutionProvider"], sess_options=opt)
    dec = ort.InferenceSession(str(dirpath / "decoder.onnx"),
                               providers=["CPUExecutionProvider"], sess_options=opt)
    return meta, enc, dec


def greedy(meta, enc, dec, text: str) -> list[str]:
    sidx = greedy.cache.setdefault(id(meta), {s: i for i, s in enumerate(meta["src"])})
    S, T = meta["max_src"], meta["max_tgt"]
    ids = [sidx.get(c, 3) for c in syllables(text)][:S]
    if not ids:
        return []
    src = np.full((1, S), PAD, dtype=np.int64)
    src[0, : len(ids)] = ids
    pad = src == PAD
    memory = enc.run(None, {"src": src, "pad": pad})[0]
    tgt = np.full((1, T), PAD, dtype=np.int64)
    tgt[0, 0] = BOS
    out: list[int] = []
    for step in range(T - 1):
        logits = dec.run(None, {"memory": memory, "mem_pad": pad, "tgt": tgt})[0][0, step]
        logits[PAD] = logits[BOS] = -1e9
        nxt = int(logits.argmax())
        if nxt == EOS:
            break
        out.append(nxt)
        tgt[0, step + 1] = nxt
    return [meta["tgt"][i] for i in out]


greedy.cache = {}  # type: ignore[attr-defined]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dirs", type=Path, nargs="+", required=True)
    ap.add_argument("--set", type=Path, default=Path("scripts/t2g_eval_set.json"))
    ap.add_argument("--limit", type=int, default=400)
    a = ap.parse_args()

    rows = json.loads(a.set.read_text(encoding="utf-8"))[: a.limit]
    golds = [r["gold"] for r in rows]
    print(f"[onnx-eval] 검증 문장 {len(rows)}")

    import time
    results = {}
    for d in a.dirs:
        meta, enc, dec = load(d)
        t0 = time.time()
        preds = [greedy(meta, enc, dec, r["text"]) for r in rows]
        ms = 1000 * (time.time() - t0) / len(rows)
        prec, rec, f1 = gloss_f1(preds, golds)
        results[d.name] = preds
        size = sum(f.stat().st_size for f in d.glob("*.onnx")) / 1e6
        print(f"\n[onnx-eval] {d.name}  ({size:.0f}MB · 문장당 {ms:.0f}ms, 1스레드)")
        print(f"  BLEU-4      {corpus_bleu(preds, golds):.1f}")
        print(f"  글로스 F1   {f1:.1f}  (정밀도 {prec:.1f} · 재현율 {rec:.1f})")
        print(f"  어순 상관   {kendall_order(preds, golds):.1f}")

    if len(a.dirs) == 2:
        x, y = [results[d.name] for d in a.dirs]
        same = sum(1 for p, q in zip(x, y) if p == q)
        print(f"\n[onnx-eval] 두 판이 글자까지 같은 문장 {same}/{len(rows)} "
              f"({100 * same / len(rows):.0f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
