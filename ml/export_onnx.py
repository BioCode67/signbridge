"""학습된 체크포인트 → ONNX (브라우저 실시간 추론용).

왜 ONNX인가: 현재 프런트엔드는 TF.js를 쓰지만, PyTorch 트랜스포머를 TF.js 그래프로
옮기는 경로는 변환 단계가 많고 깨지기 쉽다. `onnxruntime-web`은 WASM(SIMD+멀티스레드)과
WebGPU 백엔드를 모두 지원하고, PyTorch가 1차 지원하는 내보내기 대상이라 훨씬 안전하다.

    python -m ml.export_onnx --checkpoint runs/isolated-v1/best.pt \
        --out public/models/ksl-transformer --quantize

산출물
    model.onnx        fp32 그래프
    model.int8.onnx   동적 양자화(--quantize) — 크기 약 1/4, CPU/WASM에서 더 빠름
    meta.json         라벨·특징 설정. **브라우저는 이 값을 그대로 따라야 한다.**

`meta.json`의 `zero_depth`가 true면 브라우저도 z 채널을 0으로 만들어 넣어야 한다
(2D 소스로 학습한 모델). 이 값을 무시하면 정확도만 조용히 떨어진다.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from ml.signbridge.features import FEATURE_DIM, SEQ_LEN
from ml.signbridge.models import (
    ContinuousSignRecognizer,
    IsolatedSignClassifier,
    ModelConfig,
)

# 18 이상이어야 현행 PyTorch 내보내기가 버전 변환 없이 그대로 낸다.
# onnxruntime-web 1.17+ 는 opset 18을 지원한다.
OPSET = 18


def load_checkpoint(path: Path):
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    config = ModelConfig(**checkpoint["config"])
    task = config.extra.get("task", "isolated")
    model = (
        ContinuousSignRecognizer(config)
        if task == "ctc"
        else IsolatedSignClassifier(config)
    )
    model.load_state_dict(checkpoint["model"])
    model.eval()
    return model, config, checkpoint, task


def export_graph(model, dummy, path: Path, dynamic_axes: dict, dynamo: bool) -> None:
    """ONNX 그래프를 파일 하나로 내보낸다.

    두 가지가 중요하다.

    1. **`dynamic_shapes` (dynamo 경로)** — 레거시 `dynamic_axes`는 torch.export 기반
       내보내기에서 무시된다. 그대로 두면 어텐션 내부 reshape에 배치·길이가 상수로
       구워져, 내보낼 때 쓴 크기 외에는 런타임에서 Reshape 오류가 난다. 조용히 깨지는
       종류라 반드시 `Dim.DYNAMIC`을 넘겨야 한다.
    2. **`external_data=False`** — 기본값은 가중치를 별도 `.data` 파일로 빼는데,
       브라우저 배포에서는 요청이 둘로 갈라지고 캐싱도 번거로워진다.
    """
    kwargs = dict(
        input_names=["input"],
        output_names=["output"],
        opset_version=OPSET,
        do_constant_folding=True,
    )
    if dynamo:
        dynamic = {axis: torch.export.Dim.DYNAMIC for axis in dynamic_axes["input"]}
        torch.onnx.export(
            model,
            (dummy,),
            str(path),
            dynamo=True,
            external_data=False,
            dynamic_shapes=(dynamic,),
            **kwargs,
        )
    else:
        torch.onnx.export(
            model, (dummy,), str(path), dynamo=False, dynamic_axes=dynamic_axes, **kwargs
        )


def quantize(onnx_path: Path, int8_path: Path, model, dummy, dynamic_axes: dict) -> bool:
    """int8 동적 양자화. 실패해도 fp32 산출물은 그대로 남긴다.

    torch.export 기반(dynamo) 그래프는 onnxruntime의 형상 추론과 충돌하는 경우가 있어,
    실패하면 레거시 TorchScript 내보내기로 다시 뽑아 양자화한다. 가중치는 같으므로
    결과 모델은 동등하다.
    """
    from onnxruntime.quantization import QuantType, quantize_dynamic

    try:
        quantize_dynamic(str(onnx_path), str(int8_path), weight_type=QuantType.QUInt8)
        return True
    except Exception as error:
        print(f"[export] dynamo 그래프 양자화 실패({type(error).__name__}) → 레거시 경로로 재시도")

    legacy_path = int8_path.with_name("model.legacy.onnx")
    try:
        export_graph(model, dummy, legacy_path, dynamic_axes, dynamo=False)
        quantize_dynamic(str(legacy_path), str(int8_path), weight_type=QuantType.QUInt8)
        return True
    except Exception as error:
        print(f"[export] ⚠️ 양자화 실패({type(error).__name__}: {error}). fp32 모델만 사용하세요.")
        return False
    finally:
        legacy_path.unlink(missing_ok=True)


def verify(onnx_path: Path, model, task: str, seq_len: int) -> None:
    """여러 입력 크기로 PyTorch와 ONNX 출력을 대조한다.

    **한 가지 크기만 확인하면 안 된다.** 동적 축이 실제로는 상수로 구워진 그래프도
    내보낼 때 쓴 크기에서는 멀쩡히 통과한다. 브라우저는 배치 1로, 평가 스크립트는
    배치 N으로 돌리므로 두 경우 모두 여기서 걸러야 한다.
    """
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        print("[export] ⚠️ onnxruntime이 없어 검증을 건너뜁니다.")
        return

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    shapes = [(1, seq_len), (4, seq_len)]
    if task == "ctc":
        shapes += [(1, 97), (3, 256)]

    worst = 0.0
    for batch, frames in shapes:
        probe = torch.randn(batch, frames, FEATURE_DIM)
        try:
            onnx_output = session.run(None, {"input": probe.numpy()})[0]
        except Exception as error:
            print(f"[export] ❌ 입력 {batch}×{frames} 실행 실패: {error}")
            print("[export]    동적 축이 그래프에 상수로 굳었을 가능성이 큽니다.")
            raise SystemExit(1)
        with torch.no_grad():
            torch_output = model(probe).numpy()
        diff = float(np.max(np.abs(onnx_output - torch_output)))
        worst = max(worst, diff)
        print(f"[export] 입력 {batch}×{frames} → 출력 {tuple(onnx_output.shape)}, 오차 {diff:.2e}")

    print(f"[export] PyTorch ↔ ONNX 최대 오차 {worst:.3e}")
    if worst > 1e-3:
        print("[export] ⚠️ 오차가 큽니다. opset·연산자 지원을 확인하세요.")


def main() -> None:
    parser = argparse.ArgumentParser(description="체크포인트 → ONNX 내보내기")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--quantize", action="store_true", help="int8 동적 양자화도 함께 생성")
    parser.add_argument("--seq-len", type=int, default=0, help="0이면 체크포인트 값 사용")
    parser.add_argument("--no-verify", action="store_true")
    args = parser.parse_args()

    model, config, checkpoint, task = load_checkpoint(args.checkpoint)
    args.out.mkdir(parents=True, exist_ok=True)

    seq_len = args.seq_len or int(config.extra.get("seq_len", SEQ_LEN))
    # 배치 2 이상으로 내보낸다. 배치 1로 내보내면 torch.export가 그 축을 상수로
    # 특수화해 버려 동적 축 지정이 무력화될 수 있다.
    export_frames = seq_len if task != "ctc" else max(seq_len, 128)
    dummy = torch.randn(2, export_frames, FEATURE_DIM)

    # 단어 분류기는 항상 SEQ_LEN 고정 길이로 들어오므로 배치 축만 동적으로 둔다.
    # CTC는 문장 길이가 제각각이라 시간 축도 동적이어야 한다.
    dynamic_axes = {"input": {0: "batch"}, "output": {0: "batch"}}
    if task == "ctc":
        dynamic_axes["input"][1] = "frames"
        dynamic_axes["output"][1] = "frames_out"

    onnx_path = args.out / "model.onnx"
    export_graph(model, dummy, onnx_path, dynamic_axes, dynamo=True)
    size_mb = onnx_path.stat().st_size / 1e6
    print(f"[export] {onnx_path} ({size_mb:.2f} MB)")

    labels = checkpoint.get("vocab", [])
    meta = {
        "task": task,
        "feature_dim": FEATURE_DIM,
        "seq_len": seq_len,
        "zero_depth": bool(config.extra.get("zero_depth", False)),
        "num_classes": config.num_classes,
        "labels": labels,
        "blank_id": 0 if task == "ctc" else None,
        "conv_stride": config.conv_stride,
        "trained_epoch": checkpoint.get("epoch"),
        "val_top1": checkpoint.get("val_top1"),
        "val_wer": checkpoint.get("val_wer"),
        "opset": OPSET,
    }
    (args.out / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[export] {args.out / 'meta.json'} (클래스 {config.num_classes}개)")

    if args.quantize:
        try:
            import onnxruntime.quantization  # noqa: F401
        except ImportError:
            print("[export] ⚠️ onnxruntime이 없어 양자화를 건너뜁니다 (pip install onnxruntime).")
        else:
            int8_path = args.out / "model.int8.onnx"
            if quantize(onnx_path, int8_path, model, dummy, dynamic_axes):
                int8_mb = int8_path.stat().st_size / 1e6
                print(f"[export] {int8_path} ({int8_mb:.2f} MB, {size_mb / int8_mb:.1f}× 축소)")

    if not args.no_verify:
        verify(onnx_path, model, task, seq_len)


if __name__ == "__main__":
    main()
