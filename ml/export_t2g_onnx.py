#!/usr/bin/env python3
"""학습된 text2gloss(KoBART) 체크포인트 → ONNX → 브라우저.

    python -m ml.export_t2g_onnx --checkpoint ~/sbruns/t2g-v3/best \
        --out ~/sbruns/t2g-onnx --quantize

**왜 필요한가.** 앱이 지금 쓰는 번역은 학습 모델이 아니라 **공기빈도 통계 사전 +
규칙**이다. 사전은 낱말을 바꿔 끼울 뿐이라, 사람 번역가가 쓰는 `자연1`(원인 표지)
같은 것은 한국어에 대응 낱말이 없어 영영 만들지 못한다. 학습된 seq2seq는 그것을
만든다. 서버 없이 쓰려면 ONNX로 내보내 브라우저에서 돌려야 한다.

**예전에 여기서 막혔다.** `optimum`의 `ORTModelForSeq2SeqLM.from_pretrained(export=True)`는
내보내기 **뒤에** ORT 래퍼를 만드는데, 그 과정에서 `onnxruntime`이 `torch.int4`를
참조한다. torch 2.5.1에는 그 dtype이 없어 `AttributeError`로 죽는다 —
**내보내기 자체가 아니라 그 다음 단계**에서 죽는 것이라 산출물도 안 남았다.
torch를 올리면 CUDA가 어긋나므로(프로젝트 규칙) 여기서는

  1. 없는 dtype을 미리 채워 두고(온전한 우회다 — 우리는 int4를 쓰지 않는다),
  2. ORT 래퍼를 만들지 않는 **순수 내보내기**(`main_export`)만 쓴다.
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import torch

# onnxruntime이 참조하는 최신 dtype들을 미리 채운다. 실제로 쓰이지는 않는다
# (우리 모델에 int4 텐서가 없다) — 조회 표를 만들 때 이름만 필요하다.
for _name in ("int4", "uint4", "float4_e2m1fn_x2"):
    if not hasattr(torch, _name):
        setattr(torch, _name, torch.uint8)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--quantize", action="store_true", help="int8 동적 양자화(크기 1/4)")
    ap.add_argument("--task", default="text2text-generation-with-past")
    a = ap.parse_args()

    from optimum.exporters.onnx import main_export

    a.out.mkdir(parents=True, exist_ok=True)
    print(f"[onnx] {a.checkpoint} → {a.out}  (task={a.task})")
    main_export(
        model_name_or_path=str(a.checkpoint),
        output=a.out,
        task=a.task,
        opset=17,          # onnxruntime-web이 안전하게 받는 범위
        device="cpu",
        do_validation=False,   # 검증은 따로 — 여기서 죽으면 산출물이 안 남는다
    )
    made = sorted(a.out.glob("*.onnx"))
    total = sum(f.stat().st_size for f in made)
    print(f"[onnx] fp32 {len(made)}개 · {total / 1e6:.0f}MB")
    for f in made:
        print(f"    {f.name}  {f.stat().st_size / 1e6:.0f}MB")

    if a.quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        qdir = a.out.parent / (a.out.name + "-int8")
        qdir.mkdir(parents=True, exist_ok=True)
        # 토크나이저·설정도 함께 옮긴다 — 브라우저가 같은 폴더에서 다 읽는다.
        for f in a.out.iterdir():
            if f.suffix in (".json", ".txt", ".model"):
                shutil.copy2(f, qdir / f.name)
        qtotal = 0
        for f in made:
            target = qdir / f.name
            quantize_dynamic(f, target, weight_type=QuantType.QInt8)
            qtotal += target.stat().st_size
            print(f"    int8 {target.name}  {target.stat().st_size / 1e6:.0f}MB")
        print(f"[onnx] int8 합계 {qtotal / 1e6:.0f}MB → {qdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
