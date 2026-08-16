"""AI Hub OpenPose 키포인트 → MediaPipe 토폴로지 변환.

AI Hub「재난 안전 정보 전달을 위한 수어영상」·「수어 영상」데이터는 **OpenPose**
(BODY_25 + 손 21×2)로 라벨링돼 있는데, 브라우저 추론은 **MediaPipe Holistic**
(Pose 33 + 손 21×2)을 쓴다. 두 토폴로지를 맞추지 않으면 학습·추론 특징이 달라진다.

이 모듈은 특징 계산에 실제로 필요한 9개 포즈 관절만 정확히 매핑한다
(`features.POSE_KEYS`). 나머지 24개 MediaPipe 관절은 어차피 쓰이지 않으므로 0으로 둔다.

⚠️ 남는 도메인 갭 두 가지 — 반드시 인지할 것
  1. **깊이(z)**: OpenPose 2D 키포인트에는 z가 없다. 이 경로로 만든 데이터로 학습하면
     `zero_depth=True`로 추론 측 z도 버려야 분포가 맞는다.
  2. **검출기 특성**: 관절 정의·지터·가림 처리 방식이 두 검출기 간에 미묘하게 다르다.
     원본 **영상이 있다면 `ml/etl/extract_mediapipe.py`로 재추출**하는 편이 항상 낫다.
     이 모듈은 영상 없이 키포인트만 받은 경우의 차선책이다.
"""

from __future__ import annotations

import numpy as np

from .features import NUM_HAND

# OpenPose BODY_25 인덱스.
_BODY25 = {
    "nose": 0,
    "neck": 1,
    "r_shoulder": 2,
    "r_elbow": 3,
    "r_wrist": 4,
    "l_shoulder": 5,
    "l_elbow": 6,
    "l_wrist": 7,
    "mid_hip": 8,
    "r_hip": 9,
    "l_hip": 12,
}

# MediaPipe Pose 인덱스 ← OpenPose BODY_25 인덱스.
# 좌/우는 두 포맷 모두 **피험자 기준(해부학적)**이라 그대로 대응된다.
MP_FROM_OP: dict[int, int] = {
    0: _BODY25["nose"],
    11: _BODY25["l_shoulder"],
    12: _BODY25["r_shoulder"],
    13: _BODY25["l_elbow"],
    14: _BODY25["r_elbow"],
    15: _BODY25["l_wrist"],
    16: _BODY25["r_wrist"],
    23: _BODY25["l_hip"],
    24: _BODY25["r_hip"],
}

MP_POSE_POINTS = 33

# OpenPose 손 21점은 MediaPipe Hands와 순서가 같다
# (0 손목, 1-4 엄지, 5-8 검지, 9-12 중지, 13-16 약지, 17-20 새끼) → 재배열 불필요.

DEFAULT_CONF_THRESHOLD = 0.1


def unflatten(flat: list[list[float]] | np.ndarray, num_points: int) -> np.ndarray:
    """OpenPose 평탄 배열 (T, num_points*3) → (T, num_points, 3)[x, y, conf]."""
    arr = np.asarray(flat, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr[None, :]
    expected = num_points * 3
    if arr.shape[1] < expected:
        pad = np.zeros((arr.shape[0], expected - arr.shape[1]), dtype=np.float32)
        arr = np.concatenate([arr, pad], axis=1)
    return arr[:, :expected].reshape(arr.shape[0], num_points, 3)


def convert_pose(
    op_pose: np.ndarray, conf_threshold: float = DEFAULT_CONF_THRESHOLD
) -> tuple[np.ndarray, np.ndarray]:
    """OpenPose BODY_25 (T, 25, 3) → MediaPipe Pose 형태 (T, 33, 3) + 신뢰도 (T, 33).

    z 채널은 0으로 채운다(2D 소스). 신뢰도가 임계값 미만인 관절은 좌표를 0으로 만들어
    "미검출"로 표시한다.
    """
    num_frames = op_pose.shape[0]
    pose = np.zeros((num_frames, MP_POSE_POINTS, 3), dtype=np.float32)
    conf = np.zeros((num_frames, MP_POSE_POINTS), dtype=np.float32)
    for mp_idx, op_idx in MP_FROM_OP.items():
        if op_idx >= op_pose.shape[1]:
            continue
        point = op_pose[:, op_idx]  # (T, 3) = x, y, conf
        ok = point[:, 2] >= conf_threshold
        pose[:, mp_idx, 0] = point[:, 0] * ok
        pose[:, mp_idx, 1] = point[:, 1] * ok
        conf[:, mp_idx] = point[:, 2]
    return pose, conf


def convert_hand(
    op_hand: np.ndarray, conf_threshold: float = DEFAULT_CONF_THRESHOLD
) -> tuple[np.ndarray, np.ndarray]:
    """OpenPose 손 (T, 21, 3) → (T, 21, 3) 좌표 + (T,) 존재 플래그.

    손목(0번)은 OpenPose에서 신뢰도가 0인 경우가 잦으므로, **손가락 관절 중 절반
    이상이 검출됐는지**로 손 존재를 판정한다(기존 웹 렌더러와 같은 기준).
    """
    num_frames = op_hand.shape[0]
    hand = np.zeros((num_frames, NUM_HAND, 3), dtype=np.float32)
    detected = op_hand[:, :, 2] >= conf_threshold  # (T, 21)
    hand[:, :, 0] = op_hand[:, :, 0] * detected
    hand[:, :, 1] = op_hand[:, :, 1] * detected
    present = detected[:, 1:].sum(axis=1) >= (NUM_HAND - 1) // 2
    hand[~present] = 0.0
    return hand, present


# ──────────────────────────────────────────────────────────────────────────
# 3D 키포인트 경로
# ──────────────────────────────────────────────────────────────────────────
# AI Hub 재난 수어 데이터 일부 클립에는 `keypoints3d`가 함께 들어 있다.
# 형식: 관절당 (x, y, z) 3개 값, 단위는 **mm(카메라 좌표계)** — 신뢰도 채널이 없다.
# 축 방향은 2D와 같다(x 오른쪽 증가, y 아래쪽 증가, z 멀수록 증가).
#
# 문제는 깊이 추정 실패 프레임에 -25,000,000 같은 값이 섞여 있다는 것이다. 그대로 쓰면
# 어깨 너비 정규화가 통째로 망가지므로 아래 위생 검사를 반드시 통과시켜야 한다.

# 사람 몸이 카메라에서 떨어져 있을 법한 범위(mm).
DEPTH_MIN_MM = 200.0
DEPTH_MAX_MM = 20000.0
# 어깨 너비의 물리적 타당 범위(mm).
SHOULDER_MIN_MM = 50.0
SHOULDER_MAX_MM = 2000.0
# 몸 중심에서 이 배수(어깨 너비)를 넘는 관절은 추정 실패로 간주한다.
OUTLIER_BODY_RADII = 8.0


def sanitize_3d(
    pose3d: np.ndarray, hands3d: tuple[np.ndarray, ...]
) -> tuple[np.ndarray, tuple[np.ndarray, ...], np.ndarray]:
    """3D 키포인트에서 추정 실패 값을 제거한다.

    Returns:
        (정리된 pose3d, 정리된 손들, frame_ok) — frame_ok가 False인 프레임은 어깨 자체가
        비정상이라 3D를 쓸 수 없다(호출부에서 2D로 폴백).
    """
    pose3d = np.array(pose3d, dtype=np.float32, copy=True)
    hands3d = tuple(np.array(h, dtype=np.float32, copy=True) for h in hands3d)

    left_shoulder = pose3d[:, _BODY25["l_shoulder"]]
    right_shoulder = pose3d[:, _BODY25["r_shoulder"]]
    center = (left_shoulder + right_shoulder) / 2.0  # (T, 3)
    width = np.linalg.norm(left_shoulder[:, :2] - right_shoulder[:, :2], axis=1)  # (T,)

    frame_ok = (
        np.isfinite(center).all(axis=1)
        & (center[:, 2] >= DEPTH_MIN_MM)
        & (center[:, 2] <= DEPTH_MAX_MM)
        & (width >= SHOULDER_MIN_MM)
        & (width <= SHOULDER_MAX_MM)
    )

    # 몸 중심에서 지나치게 멀리 떨어진 관절은 0(미검출)으로 만든다.
    radius = (OUTLIER_BODY_RADII * np.maximum(width, 1.0))[:, None]
    for array in (pose3d, *hands3d):
        distance = np.linalg.norm(array - center[:, None, :], axis=2)  # (T, J)
        bad = ~np.isfinite(distance) | (distance > radius)
        array[bad] = 0.0
        array[~frame_ok] = 0.0

    return pose3d, hands3d, frame_ok


def convert_clip_3d(keypoints3d: dict) -> tuple[dict[str, np.ndarray], np.ndarray]:
    """AI Hub `keypoints3d` → 랜드마크 팩 배열 + 프레임별 3D 유효 마스크.

    2D 경로와 달리 z가 실제 깊이라, 브라우저 MediaPipe 입력(z 포함)과 특징 공간이
    훨씬 잘 맞는다. **가능하면 이 경로를 쓸 것.**
    """
    num_points_pose = 25
    pose3d = unflatten(keypoints3d["pose"], num_points_pose)
    num_frames = pose3d.shape[0]
    empty = np.zeros((num_frames, NUM_HAND * 3), dtype=np.float32)
    left3d = unflatten(keypoints3d.get("hand_left", empty), NUM_HAND)
    right3d = unflatten(keypoints3d.get("hand_right", empty), NUM_HAND)
    pose3d, left3d, right3d = align_lengths(pose3d, left3d, right3d)
    num_frames = pose3d.shape[0]

    pose3d, (left3d, right3d), frame_ok = sanitize_3d(pose3d, (left3d, right3d))

    pose = np.zeros((num_frames, MP_POSE_POINTS, 3), dtype=np.float32)
    conf = np.zeros((num_frames, MP_POSE_POINTS), dtype=np.float32)
    for mp_idx, op_idx in MP_FROM_OP.items():
        point = pose3d[:, op_idx]
        detected = np.any(point != 0.0, axis=1)
        pose[:, mp_idx] = point
        conf[:, mp_idx] = detected.astype(np.float32)

    def hand_presence(hand: np.ndarray) -> np.ndarray:
        detected = np.any(hand != 0.0, axis=2)  # (T, 21)
        return detected[:, 1:].sum(axis=1) >= (NUM_HAND - 1) // 2

    left_present = hand_presence(left3d) & frame_ok
    right_present = hand_presence(right3d) & frame_ok
    left3d[~left_present] = 0.0
    right3d[~right_present] = 0.0

    arrays = {
        "pose": pose,
        "pose_conf": conf,
        "pose_present": (conf > 0) & frame_ok[:, None],
        "left": left3d,
        "right": right3d,
        "left_present": left_present,
        "right_present": right_present,
    }
    return arrays, frame_ok


def align_lengths(*arrays: np.ndarray) -> tuple[np.ndarray, ...]:
    """스트림별 프레임 수를 가장 짧은 것에 맞춘다.

    AI Hub 클립은 포즈·왼손·오른손의 프레임 수가 몇 장씩 어긋나 있는 경우가 있다
    (예: 포즈 615, 손 611). 뒤쪽 몇 프레임을 버리는 편이 0으로 채우는 것보다 안전하다.
    """
    length = min(array.shape[0] for array in arrays)
    return tuple(array[:length] for array in arrays)


def convert_clip(
    keypoints: dict, conf_threshold: float = DEFAULT_CONF_THRESHOLD
) -> dict[str, np.ndarray]:
    """AI Hub `keypoints` 딕셔너리 → 랜드마크 팩(`ml.signbridge.pack` 포맷).

    Args:
        keypoints: {"pose": [[...75]], "hand_left": [[...63]], "hand_right": [[...63]]}
    """
    op_pose = unflatten(keypoints["pose"], 25)
    num_frames = op_pose.shape[0]
    zeros_hand = np.zeros((num_frames, NUM_HAND * 3), dtype=np.float32)
    op_left = unflatten(keypoints.get("hand_left", zeros_hand), NUM_HAND)
    op_right = unflatten(keypoints.get("hand_right", zeros_hand), NUM_HAND)
    op_pose, op_left, op_right = align_lengths(op_pose, op_left, op_right)

    pose, pose_conf = convert_pose(op_pose, conf_threshold)
    left, left_present = convert_hand(op_left, conf_threshold)
    right, right_present = convert_hand(op_right, conf_threshold)

    return {
        "pose": pose,
        "pose_conf": pose_conf,
        "pose_present": pose_conf >= conf_threshold,
        "left": left,
        "right": right,
        "left_present": left_present,
        "right_present": right_present,
    }
