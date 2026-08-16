"""랜드마크 팩(.npz) 입출력.

ETL 단계(OpenPose 변환 / MediaPipe 재추출)의 **공통 중간 산출물**이다. 어느 경로로
만들었든 학습 코드는 이 포맷만 본다.

배열 구성 (T = 프레임 수)
    pose          float16 (T, 33, 3)   MediaPipe Pose 좌표. 미사용 관절은 0.
    pose_conf     float16 (T, 33)      관절 신뢰도/가시성.
    left          float16 (T, 21, 3)   왼손 좌표.
    right         float16 (T, 21, 3)   오른손 좌표.
    left_present  bool    (T,)         해당 프레임 왼손 검출 여부.
    right_present bool    (T,)         오른손 검출 여부.
    meta          문자열   JSON        fps·원문·글로스 타임코드 등.

float16으로 저장하는 이유: 좌표는 어깨 너비로 정규화되면 대략 [-4, 4] 범위라
fp16 정밀도(~1e-3)로 충분하고, 용량이 절반이 된다. AI Hub 전량을 다루면
디스크가 곧 비용이다.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ARRAY_KEYS = ("pose", "pose_conf", "left", "right", "left_present", "right_present")
# 관절별 검출 여부. 미검출 관절을 0으로 남기려면 필요하다(브라우저와 같은 규칙).
# 초기 팩에는 없을 수 있어 로드 시 pose_conf > 0으로 대체한다.
OPTIONAL_ARRAY_KEYS = ("pose_present",)


def save_pack(path: str | Path, arrays: dict[str, np.ndarray], meta: dict) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, np.ndarray] = {}
    for key in (*ARRAY_KEYS, *OPTIONAL_ARRAY_KEYS):
        value = arrays.get(key)
        if value is None:
            continue
        if value.dtype == np.bool_:
            payload[key] = value
        else:
            payload[key] = value.astype(np.float16)
    payload["meta"] = np.array(json.dumps(meta, ensure_ascii=False))
    np.savez_compressed(path, **payload)


def load_pack(path: str | Path) -> tuple[dict[str, np.ndarray], dict]:
    with np.load(path, allow_pickle=False) as data:
        arrays = {key: data[key] for key in ARRAY_KEYS}
        for key in OPTIONAL_ARRAY_KEYS:
            if key in data.files:
                arrays[key] = data[key]
        meta = json.loads(str(data["meta"]))
    for key in ("pose", "pose_conf", "left", "right"):
        arrays[key] = arrays[key].astype(np.float32)
    if "pose_present" not in arrays:
        arrays["pose_present"] = arrays["pose_conf"] > 0
    return arrays, meta


# 어깨 너비로 정규화한 좌표가 이 배수를 넘으면 물리적으로 말이 안 된다.
# 사람 팔은 어깨 너비의 3배를 넘지 않는다. 그런데도 큰 값이 나온다면 원인은 하나 —
# **어깨가 잘못 잡혀 어깨 너비가 비정상적으로 작게 계산된 것**이고, 그러면 1/폭이
# 폭주해 클립 전체가 쓰레기가 된다. 에러 없이 학습이 망가지는 종류라 미리 잡는다.
SANE_FEATURE_LIMIT = 20.0


def feature_health(arrays: dict[str, np.ndarray]) -> float:
    """팩 배열에서 정규화 특징의 최대 절댓값을 구한다(클립 건전성 지표).

    `SANE_FEATURE_LIMIT`를 넘으면 어깨 검출이 무너진 클립이다.
    """
    from .features import clip_to_features

    feats, valid = clip_to_features(
        arrays["pose"],
        arrays["left"],
        arrays["right"],
        arrays["left_present"],
        arrays["right_present"],
        arrays.get("pose_present"),
    )
    if not bool(np.any(valid)):
        return 0.0
    return float(np.max(np.abs(feats[valid])))


def pack_to_features(path: str | Path, zero_depth: bool = False) -> tuple[np.ndarray, dict]:
    """팩을 곧바로 (T, 155) 특징 행렬로 로드한다.

    어깨 미검출 프레임은 값이 0이고 `meta["valid_mask"]`가 False로 표시된다. 브라우저의
    `frameToFeatures`가 그런 프레임에 null을 반환해 버리는 것과 맞추려면 호출부에서
    마스크로 걸러내면 된다(`dataset.py`가 그렇게 한다).
    """
    from .features import clip_to_features, zero_depth as _zero_depth

    arrays, meta = load_pack(path)
    feats, valid = clip_to_features(
        arrays["pose"],
        arrays["left"],
        arrays["right"],
        arrays["left_present"],
        arrays["right_present"],
        arrays.get("pose_present"),
    )
    meta = dict(meta)
    meta["valid_mask"] = valid
    if zero_depth:
        feats = _zero_depth(feats)
    return feats, meta
