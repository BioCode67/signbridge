"""파이썬 학습 특징 == 타입스크립트 추론 특징 인지 **실제로 실행해서** 검증한다.

학습(파이썬)과 추론(브라우저 TS)이 서로 다른 특징을 만들면, 검증 정확도는 멀쩡한데
실제 웹캠에서는 동작하지 않는 가장 찾기 어려운 버그가 된다. 두 구현을 눈으로 대조하는
것으로는 부족하다 — 같은 입력을 양쪽에 넣고 수치를 비교한다.

무작위 프레임(손 유무·어깨 폭·결측 관절 조합 포함)을 생성해
  1) `src/recognition/landmarks.ts`를 Node로 직접 실행하고
  2) `ml/signbridge/features.py`로 같은 입력을 계산해
최대 절대 오차를 비교한다.

    python -m ml.tools.feature_parity            # 기본 200 프레임
    python -m ml.tools.feature_parity --frames 2000 --seed 7

Node 22의 타입 스트리핑(`--experimental-strip-types`)을 쓰므로 별도 빌드가 필요 없다.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.signbridge.features import (  # noqa: E402
    FEATURE_DIM,
    SEQ_LEN,
    frame_to_features,
    resample_sequence,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# float32 왕복 + JSON 직렬화를 감안한 허용 오차.
TOLERANCE = 2e-5

LANDMARKS_TS = REPO_ROOT / "src" / "recognition" / "landmarks.ts"

# 임시 디렉터리에서 실행하므로 상대 경로가 아닌 절대 파일 URL로 가져온다.
NODE_SCRIPT = r"""
import { readFileSync, writeFileSync } from 'node:fs'
import { frameToFeatures, resampleSequence } from '__LANDMARKS_URL__'

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const features = input.frames.map((frame) => {
  const result = frameToFeatures({
    pose: frame.pose,
    leftHand: frame.leftHand,
    rightHand: frame.rightHand,
  })
  return result === null ? null : Array.from(result)
})

// 리샘플 검증: null이 아닌 특징만 모아 SEQ_LEN으로 줄인다.
const kept = features.filter((f) => f !== null).map((f) => Float32Array.from(f))
const resampled = kept.length ? Array.from(resampleSequence(kept, input.seqLen)) : []

writeFileSync(process.argv[3], JSON.stringify({ features, resampled }))
"""


def make_frames(count: int, seed: int) -> list[dict]:
    """다양한 경계 조건을 포함한 무작위 프레임."""
    rng = np.random.default_rng(seed)
    frames: list[dict] = []
    for index in range(count):
        pose = rng.uniform(0.0, 1.0, size=(33, 3)).astype(np.float64)

        # 어깨 폭을 일부러 다양하게(정상 / 아주 좁음 / 0 → None 반환 경로).
        mode = index % 12
        if mode == 0:
            pose[11, :2] = pose[12, :2]  # 폭 0 → None
        elif mode == 1:
            pose[11, 0] = pose[12, 0] + 5e-5  # 임계값 근처
        elif mode == 2:
            pose[11, 0] = pose[12, 0] + 0.9  # 아주 넓음

        # 손 유무 조합 4가지를 고르게 섞는다.
        has_left = index % 4 in (0, 1)
        has_right = index % 4 in (0, 2)
        left = rng.uniform(0.0, 1.0, size=(21, 3)) if has_left else np.zeros((0, 3))
        right = rng.uniform(0.0, 1.0, size=(21, 3)) if has_right else np.zeros((0, 3))

        frames.append(
            {
                "pose": [
                    {"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in pose
                ],
                "leftHand": [
                    {"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in left
                ],
                "rightHand": [
                    {"x": float(p[0]), "y": float(p[1]), "z": float(p[2])} for p in right
                ],
                "_pose": pose.tolist(),
                "_left": left.tolist(),
                "_right": right.tolist(),
            }
        )
    return frames


def run_node(frames: list[dict], seq_len: int) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        script = temp / "parity.mjs"
        script.write_text(
            NODE_SCRIPT.replace("__LANDMARKS_URL__", LANDMARKS_TS.as_uri()), encoding="utf-8"
        )
        payload = temp / "input.json"
        output = temp / "output.json"
        payload.write_text(
            json.dumps(
                {
                    "seqLen": seq_len,
                    "frames": [
                        {k: v for k, v in f.items() if not k.startswith("_")} for f in frames
                    ],
                }
            ),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                "--no-warnings",
                str(script),
                str(payload),
                str(output),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(f"Node 실행 실패:\n{result.stdout}\n{result.stderr}")
        return json.loads(output.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="TS ↔ 파이썬 특징 일치 검증")
    parser.add_argument("--frames", type=int, default=200)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--seq-len", type=int, default=SEQ_LEN)
    args = parser.parse_args()

    frames = make_frames(args.frames, args.seed)
    js = run_node(frames, args.seq_len)

    max_diff = 0.0
    mismatched_none = 0
    kept: list[np.ndarray] = []

    for index, frame in enumerate(frames):
        pose = np.asarray(frame["_pose"], dtype=np.float64)
        left = np.asarray(frame["_left"], dtype=np.float64)
        right = np.asarray(frame["_right"], dtype=np.float64)
        python_result = frame_to_features(
            pose,
            left if len(left) == 21 else None,
            right if len(right) == 21 else None,
        )
        js_result = js["features"][index]

        if (python_result is None) != (js_result is None):
            mismatched_none += 1
            print(
                f"  [불일치] frame {index}: python={'None' if python_result is None else 'ok'} "
                f"js={'null' if js_result is None else 'ok'}"
            )
            continue
        if python_result is None:
            continue

        diff = float(np.max(np.abs(python_result - np.asarray(js_result, dtype=np.float32))))
        max_diff = max(max_diff, diff)
        if diff > TOLERANCE:
            channel = int(np.argmax(np.abs(python_result - np.asarray(js_result))))
            print(f"  [불일치] frame {index}: 최대오차 {diff:.3e} (채널 {channel})")
        kept.append(python_result)

    resample_diff = 0.0
    if kept and js["resampled"]:
        python_resampled = resample_sequence(np.stack(kept), args.seq_len).reshape(-1)
        js_resampled = np.asarray(js["resampled"], dtype=np.float32)
        if python_resampled.shape != js_resampled.shape:
            raise SystemExit(
                f"리샘플 결과 형상 불일치: python {python_resampled.shape} vs js {js_resampled.shape}"
            )
        resample_diff = float(np.max(np.abs(python_resampled - js_resampled)))

    print(f"\n프레임 {len(frames)}개 (유효 {len(kept)}개), 차원 {FEATURE_DIM}")
    print(f"frameToFeatures  최대 절대 오차: {max_diff:.3e}")
    print(f"resampleSequence 최대 절대 오차: {resample_diff:.3e}")

    failed = mismatched_none > 0 or max_diff > TOLERANCE or resample_diff > TOLERANCE
    if failed:
        print(f"\n❌ 불일치. None 반환 불일치 {mismatched_none}건, 허용 오차 {TOLERANCE:.0e}")
        print("   → landmarks.ts와 features.py 중 한쪽만 수정한 게 아닌지 확인하세요.")
        raise SystemExit(1)
    print("\n✅ 학습(파이썬)과 추론(TS)의 특징이 일치합니다.")


if __name__ == "__main__":
    main()
