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

    def forward(self, src: torch.Tensor, pad: torch.Tensor) -> torch.Tensor:
        import math
        h = self.m.pos(self.m.src_emb(src) * math.sqrt(self.m.d))
        return self.m.tr.encoder(h, src_key_padding_mask=pad)


class DecoderWrap(nn.Module):
    """인과 마스크는 그래프 안에 고정 크기로 굽는다(입력 길이가 고정이라 안전하다)."""

    def __init__(self, m: SmallT2G, max_tgt: int) -> None:
        super().__init__()
        self.m = m
        self.register_buffer(
            "causal", torch.triu(torch.full((max_tgt, max_tgt), float("-inf")), diagonal=1)
        )

    def forward(self, memory: torch.Tensor, mem_pad: torch.Tensor,
                tgt: torch.Tensor) -> torch.Tensor:
        import math
        h = self.m.pos(self.m.tgt_emb(tgt) * math.sqrt(self.m.d))
        h = self.m.tr.decoder(h, memory, tgt_mask=self.causal,
                              memory_key_padding_mask=mem_pad)
        return self.m.out(h)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True, help="t2gs 출력 폴더")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--quantize", action="store_true")
    ap.add_argument("--max-src", type=int, default=128,
                    help="입력 음절 칸 수(고정). 재난문자는 대개 60~120음절이다")
    a = ap.parse_args()

    # **MultiheadAttention의 빠른 경로를 끈다.**
    #
    # 켜 두면 트레이서가 어텐션 안의 reshape에 **그때의 문장 길이를 상수로 굽는다.**
    # 내보내기는 성공하고 파일도 나오는데, 길이가 다른 문장을 넣는 순간
    # `Reshape ... requested shape {24,6,64}` 로 죽는다(실측: 24글자로 뽑고
    # 29글자를 넣었더니 바로 깨졌다). 빌드가 아니라 **실행 시점에** 드러나는 종류라
    # 반드시 돌려 보고 확인해야 한다.
    torch.backends.mha.set_fastpath_enabled(False)

    ck = torch.load(a.checkpoint / "best.pt", map_location="cpu", weights_only=False)
    cfg = ck["cfg"]
    model = SmallT2G(cfg["n_src"], cfg["n_tgt"], d=cfg["d"], enc=cfg["enc"], dec=cfg["dec"])
    model.load_state_dict(ck["model"])
    model.eval()

    a.out.mkdir(parents=True, exist_ok=True)
    # **모양을 전부 고정한다.**
    #
    # 동적 길이로 내보내는 두 길을 다 시도했는데 둘 다 막혔다:
    #   · 예전 트레이서(dynamic_axes) → 어텐션 reshape에 그때의 길이가 **상수로 구워진다.**
    #     파일은 나오는데 길이가 다른 문장에서 죽는다
    #     (`Reshape ... Input shape:{29,1,384}, requested shape:{24,6,64}`, 실측).
    #   · dynamo → 디코더에서 `Could not guard on data-dependent expression Eq(u0, 1)`.
    #
    # 그래서 입력 길이를 고정하고 **패딩 마스크로 처리**한다. 학습 때도 마스크를
    # 쓰므로 결과가 달라지지 않는다. 그래프가 완전히 정적이라 브라우저에서
    # 모양 때문에 깨질 자리가 아예 없다 — 대가는 짧은 문장에서도 정해진 칸을
    # 다 계산하는 것뿐이고, 모델이 작아 문제되지 않는다.
    S_FIX = int(a.max_src)
    T_FIX = int(cfg["max_tgt"])

    src = torch.full((1, S_FIX), PAD, dtype=torch.long)
    src[0, :20] = torch.randint(4, cfg["n_src"], (20,))
    pad = src == PAD
    tgt = torch.full((1, T_FIX), PAD, dtype=torch.long)
    tgt[0, 0] = BOS
    with torch.no_grad():
        memory = EncoderWrap(model)(src, pad)

    torch.onnx.export(
        EncoderWrap(model), (src, pad), a.out / "encoder.onnx",
        input_names=["src", "pad"], output_names=["memory"],
        opset_version=OPSET, do_constant_folding=True,
    )
    torch.onnx.export(
        DecoderWrap(model, T_FIX), (memory, pad, tgt), a.out / "decoder.onnx",
        input_names=["memory", "mem_pad", "tgt"], output_names=["logits"],
        opset_version=OPSET, do_constant_folding=True,
    )

    vocab = json.loads((a.checkpoint / "vocab.json").read_text(encoding="utf-8"))
    (a.out / "meta.json").write_text(json.dumps({
        # 방향은 체크포인트에 적힌 것을 따른다(없으면 예전 파일이라 text2gloss).
        # 브라우저가 이 값을 보고 넣을 것과 받을 것을 정한다.
        "task": cfg.get("direction", "text2gloss"),
        "src": vocab["src"], "tgt": vocab["tgt"],
        "pad": PAD, "bos": BOS, "eos": EOS,
        "max_src": S_FIX, "max_tgt": T_FIX, "fixed_shapes": True,
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
