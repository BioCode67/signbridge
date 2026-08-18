#!/usr/bin/env python3
"""소형 text2gloss 체크포인트 → ONNX 두 개(인코더·디코더) → 브라우저.

    python -m ml.export_t2gs_onnx --checkpoint ~/sbruns/t2gs-v1 \
        --out public/models/t2g --quantize

**왜 둘로 나누나.** 브라우저에서는 한 낱말씩 뽑는 그리디 디코딩을 한다.
인코더는 문장당 한 번, 디코더는 낱말 수만큼 돈다. 한 그래프로 묶으면 매 낱말마다
인코더까지 다시 도는 낭비가 생긴다.

**왜 KV 캐시를 안 쓰나.** 캐시를 넣으면 그래프가 복잡해지고(과거 상태 입출력이
층마다 붙는다) 브라우저 쪽 코드도 그만큼 늘어난다. 우리 문장은 글로스 40개를
넘지 않고 모델도 작아서, 매 스텝 앞부분을 다시 계산해도 충분히 빠르다.
**먼저 맞게 돌게 하고, 느리면 그때 캐시를 넣는다.**

배치 1·패딩 없음으로 고정해 마스크 입력을 없앴다 — 그래프가 단순해지고
브라우저 코드에서 실수할 자리가 줄어든다.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import torch
import torch.nn as nn

from ml.train_t2g_small import BOS, EOS, PAD, SmallT2G

OPSET = 17


class EncoderWrap(nn.Module):
    def __init__(self, m: SmallT2G) -> None:
        super().__init__()
        self.m = m

    def forward(self, src: torch.Tensor) -> torch.Tensor:
        import math
        h = self.m.pos(self.m.src_emb(src) * math.sqrt(self.m.d))
        return self.m.tr.encoder(h)


class DecoderWrap(nn.Module):
    def __init__(self, m: SmallT2G) -> None:
        super().__init__()
        self.m = m

    def forward(self, memory: torch.Tensor, tgt: torch.Tensor) -> torch.Tensor:
        import math
        causal = nn.Transformer.generate_square_subsequent_mask(tgt.size(1), device=tgt.device)
        h = self.m.pos(self.m.tgt_emb(tgt) * math.sqrt(self.m.d))
        h = self.m.tr.decoder(h, memory, tgt_mask=causal)
        return self.m.out(h)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True, help="t2gs 출력 폴더")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--quantize", action="store_true")
    a = ap.parse_args()

    ck = torch.load(a.checkpoint / "best.pt", map_location="cpu", weights_only=False)
    cfg = ck["cfg"]
    model = SmallT2G(cfg["n_src"], cfg["n_tgt"], d=cfg["d"], enc=cfg["enc"], dec=cfg["dec"])
    model.load_state_dict(ck["model"])
    model.eval()

    a.out.mkdir(parents=True, exist_ok=True)
    src = torch.randint(4, cfg["n_src"], (1, 24))
    with torch.no_grad():
        memory = EncoderWrap(model)(src)
    tgt = torch.tensor([[BOS, 5, 6]])

    torch.onnx.export(
        EncoderWrap(model), (src,), a.out / "encoder.onnx",
        input_names=["src"], output_names=["memory"],
        dynamic_axes={"src": {1: "S"}, "memory": {1: "S"}},
        opset_version=OPSET, do_constant_folding=True,
    )
    torch.onnx.export(
        DecoderWrap(model), (memory, tgt), a.out / "decoder.onnx",
        input_names=["memory", "tgt"], output_names=["logits"],
        dynamic_axes={"memory": {1: "S"}, "tgt": {1: "T"}, "logits": {1: "T"}},
        opset_version=OPSET, do_constant_folding=True,
    )

    vocab = json.loads((a.checkpoint / "vocab.json").read_text(encoding="utf-8"))
    (a.out / "meta.json").write_text(json.dumps({
        "task": "text2gloss",
        "src": vocab["src"], "tgt": vocab["tgt"],
        "pad": PAD, "bos": BOS, "eos": EOS,
        "max_src": cfg["max_src"], "max_tgt": cfg["max_tgt"],
        "d_model": cfg["d"], "enc": cfg["enc"], "dec": cfg["dec"],
        "opset": OPSET,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    for f in sorted(a.out.glob("*.onnx")):
        print(f"  {f.name}  {f.stat().st_size / 1e6:.1f}MB")

    if a.quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        total = 0
        for name in ("encoder", "decoder"):
            src_f = a.out / f"{name}.onnx"
            dst = a.out / f"{name}.int8.onnx"
            quantize_dynamic(src_f, dst, weight_type=QuantType.QInt8)
            total += dst.stat().st_size
            print(f"  int8 {dst.name}  {dst.stat().st_size / 1e6:.1f}MB")
            src_f.unlink()                       # fp32는 남기지 않는다(용량)
            shutil.move(dst, src_f)
        print(f"[onnx] 합계 {total / 1e6:.1f}MB → {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
