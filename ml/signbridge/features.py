"""랜드마크 → 고정 차원 특징 벡터.

**이 파일은 `src/recognition/landmarks.ts`의 파이썬 포팅이며, 두 구현은 수치적으로
동일해야 한다.** 학습(파이썬/GPU)과 추론(브라우저/TS)이 다른 특징을 쓰면 모델은
조용히 망가진다. 한쪽을 고치면 반드시 다른 쪽도 고치고
`python -m ml.tools.feature_parity`로 검증할 것.

특징 정의(155차원)
    포즈 9관절 × (x, y, z)   = 27
    왼손 21관절 × (x, y, z)  = 63
    오른손 21관절 × (x, y, z) = 63
    손 존재 플래그 2개        =  2
    ------------------------------------
                              155

정규화: 어깨 중점을 원점, 어깨 너비(x·y 평면 거리)를 스케일 단위로 삼는다.
→ 카메라 거리·화면 위치·해상도에 불변. OpenPose 픽셀 좌표와 MediaPipe 정규화
좌표가 이 변환 후 같은 공간에 놓이는 이유이기도 하다.
"""

from __future__ import annotations

import numpy as np

# MediaPipe Pose 33점 중 상반신 수어에 유의미한 관절만 선별.
# 코 · 양 어깨 · 양 팔꿈치 · 양 손목 · 양 엉덩이.
POSE_KEYS: tuple[int, ...] = (0, 11, 12, 13, 14, 15, 16, 23, 24)

NUM_POSE = len(POSE_KEYS)  # 9
NUM_HAND = 21
FEATURE_DIM = NUM_POSE * 3 + NUM_HAND * 3 * 2 + 2  # 155
SEQ_LEN = 32

# 특징 벡터 내 블록 경계 (증강·미러링에서 사용).
POSE_SLICE = slice(0, NUM_POSE * 3)  # 0..27
LHAND_SLICE = slice(NUM_POSE * 3, NUM_POSE * 3 + NUM_HAND * 3)  # 27..90
RHAND_SLICE = slice(NUM_POSE * 3 + NUM_HAND * 3, NUM_POSE * 3 + NUM_HAND * 6)  # 90..153
FLAG_SLICE = slice(FEATURE_DIM - 2, FEATURE_DIM)  # 153..155

# 좌우 대칭 미러링 시 서로 교환되는 포즈 관절 (POSE_KEYS 배열 내 인덱스).
# 0=코(고정), (1,2)=어깨, (3,4)=팔꿈치, (5,6)=손목, (7,8)=엉덩이.
POSE_MIRROR_PAIRS: tuple[tuple[int, int], ...] = ((1, 2), (3, 4), (5, 6), (7, 8))

MIN_SHOULDER_WIDTH = 1e-4


def frame_to_features(
    pose: np.ndarray | None,
    left_hand: np.ndarray | None,
    right_hand: np.ndarray | None,
    pose_present: np.ndarray | None = None,
) -> np.ndarray | None:
    """한 프레임의 랜드마크를 155차원 특징으로 변환. 실패 시 None.

    Args:
        pose: (33, 3) — MediaPipe Pose 랜드마크(x, y, z). 없으면 None.
        left_hand: (21, 3) 또는 None(미검출).
        right_hand: (21, 3) 또는 None(미검출).
        pose_present: (33,) bool — 관절별 검출 여부. None이면 전부 검출로 본다
            (MediaPipe는 항상 33점을 반환하므로 브라우저 경로가 이에 해당).

    TS `frameToFeatures`와 동일하게, 어깨가 없으면(수어 자세가 아니면) None을
    반환해 해당 프레임을 버린다. 미검출 관절·손은 **0으로 남긴다**(TS와 동일 규칙).
    """
    if pose is None or len(pose) < 25:
        return None

    left_shoulder = pose[11]
    right_shoulder = pose[12]
    center = (left_shoulder[:3] + right_shoulder[:3]) / 2.0

    dx = float(left_shoulder[0] - right_shoulder[0])
    dy = float(left_shoulder[1] - right_shoulder[1])
    shoulder_width = float(np.hypot(dx, dy))
    if shoulder_width < MIN_SHOULDER_WIDTH:
        return None
    inv = 1.0 / shoulder_width

    out = np.zeros(FEATURE_DIM, dtype=np.float32)
    o = 0
    for idx in POSE_KEYS:
        if pose_present is None or bool(pose_present[idx]):
            out[o : o + 3] = (pose[idx][:3] - center) * inv
        o += 3

    has_left = left_hand is not None and len(left_hand) == NUM_HAND
    has_right = right_hand is not None and len(right_hand) == NUM_HAND
    if has_left:
        out[o : o + NUM_HAND * 3] = ((left_hand[:, :3] - center) * inv).reshape(-1)
    o += NUM_HAND * 3
    if has_right:
        out[o : o + NUM_HAND * 3] = ((right_hand[:, :3] - center) * inv).reshape(-1)
    o += NUM_HAND * 3

    out[o] = 1.0 if has_left else 0.0
    out[o + 1] = 1.0 if has_right else 0.0
    return out


def clip_to_features(
    pose: np.ndarray,
    left_hand: np.ndarray,
    right_hand: np.ndarray,
    left_present: np.ndarray,
    right_present: np.ndarray,
    pose_present: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """클립 전체를 한 번에 변환(벡터화). `frame_to_features`와 결과가 같다.

    Args:
        pose: (T, 33, 3)
        left_hand / right_hand: (T, 21, 3)
        left_present / right_present: (T,) bool — 해당 프레임에 손이 검출됐는지.
        pose_present: (T, 33) bool — 관절별 검출 여부. None이면 전부 검출로 본다.

    Returns:
        (features, valid) — features (T, 155) float32, valid (T,) bool.
        valid=False인 프레임은 어깨 미검출이라 값이 0으로 채워져 있다.
    """
    pose = np.asarray(pose, dtype=np.float32)
    left_hand = np.asarray(left_hand, dtype=np.float32)
    right_hand = np.asarray(right_hand, dtype=np.float32)
    num_frames = pose.shape[0]
    if not (left_hand.shape[0] == right_hand.shape[0] == num_frames):
        raise ValueError(
            "포즈·손 스트림의 프레임 수가 다릅니다 "
            f"(pose={num_frames}, left={left_hand.shape[0]}, right={right_hand.shape[0]}). "
            "ETL에서 ml.signbridge.openpose.align_lengths로 맞춘 뒤 팩을 다시 만드세요."
        )

    center = (pose[:, 11, :3] + pose[:, 12, :3]) / 2.0  # (T, 3)
    delta = pose[:, 11, :2] - pose[:, 12, :2]
    shoulder_width = np.hypot(delta[:, 0], delta[:, 1])  # (T,)
    valid = shoulder_width >= MIN_SHOULDER_WIDTH
    inv = np.zeros_like(shoulder_width)
    np.divide(1.0, shoulder_width, out=inv, where=valid)
    inv = inv[:, None, None]  # (T, 1, 1)
    center = center[:, None, :]  # (T, 1, 3)

    feats = np.zeros((num_frames, FEATURE_DIM), dtype=np.float32)
    sel = pose[:, POSE_KEYS, :3]  # (T, 9, 3)
    pose_feats = (sel - center) * inv
    if pose_present is not None:
        # 미검출 관절은 0으로 남긴다(TS `frameToFeatures`와 동일 규칙).
        pose_feats = pose_feats * np.asarray(pose_present)[:, POSE_KEYS, None]
    feats[:, POSE_SLICE] = pose_feats.reshape(num_frames, -1)

    lh = ((left_hand[:, :, :3] - center) * inv) * left_present[:, None, None]
    rh = ((right_hand[:, :, :3] - center) * inv) * right_present[:, None, None]
    feats[:, LHAND_SLICE] = lh.reshape(num_frames, -1)
    feats[:, RHAND_SLICE] = rh.reshape(num_frames, -1)
    feats[:, FEATURE_DIM - 2] = left_present.astype(np.float32)
    feats[:, FEATURE_DIM - 1] = right_present.astype(np.float32)

    feats[~valid] = 0.0
    return feats, valid


def resample_sequence(frames: np.ndarray, seq_len: int = SEQ_LEN) -> np.ndarray:
    """가변 길이 (T, 155) 시퀀스를 seq_len 길이로 균일 리샘플.

    TS `resampleSequence`와 **같은 최근접 인덱싱**을 쓴다(보간 아님). 브라우저가
    보간을 하지 않으므로 학습도 하지 않아야 분포가 일치한다.
    """
    out = np.zeros((seq_len, FEATURE_DIM), dtype=np.float32)
    num_frames = frames.shape[0]
    if num_frames == 0:
        return out
    if num_frames == 1:
        out[:] = frames[0]
        return out
    steps = np.arange(seq_len, dtype=np.float64)
    # JS Math.round는 .5를 위로 올리므로 floor(x + 0.5)와 같다(양수 구간).
    idx = np.floor(steps * (num_frames - 1) / (seq_len - 1) + 0.5).astype(np.int64)
    np.clip(idx, 0, num_frames - 1, out=idx)
    out[:] = frames[idx]
    return out


def mirror_features(feats: np.ndarray) -> np.ndarray:
    """좌우 반전된 특징을 만든다(데이터 증강용).

    x축 부호를 뒤집고, 좌우 대칭 관절과 양손 블록·존재 플래그를 맞바꾼다.
    수어에서 우세손(dominant hand)은 의미를 바꿀 수 있으므로 **무분별한 사용은
    금물**이다. 왼손잡이 수형 대응이나 소량 증강에만 쓰고, 비율은 설정으로 통제한다.
    """
    feats = np.array(feats, dtype=np.float32, copy=True)
    single = feats.ndim == 1
    if single:
        feats = feats[None, :]

    pose = feats[:, POSE_SLICE].reshape(len(feats), NUM_POSE, 3)
    for a, b in POSE_MIRROR_PAIRS:
        pose[:, [a, b]] = pose[:, [b, a]]
    pose[:, :, 0] *= -1.0
    feats[:, POSE_SLICE] = pose.reshape(len(feats), -1)

    lh = feats[:, LHAND_SLICE].reshape(len(feats), NUM_HAND, 3).copy()
    rh = feats[:, RHAND_SLICE].reshape(len(feats), NUM_HAND, 3).copy()
    lh[:, :, 0] *= -1.0
    rh[:, :, 0] *= -1.0
    feats[:, LHAND_SLICE] = rh.reshape(len(feats), -1)
    feats[:, RHAND_SLICE] = lh.reshape(len(feats), -1)

    flags = feats[:, FLAG_SLICE].copy()
    feats[:, FEATURE_DIM - 2] = flags[:, 1]
    feats[:, FEATURE_DIM - 1] = flags[:, 0]

    return feats[0] if single else feats


def zero_depth(feats: np.ndarray) -> np.ndarray:
    """모든 z 채널을 0으로 만든다.

    AI Hub OpenPose 키포인트는 2D라 z가 없다. 2D 소스로 학습한 모델을 3D가 있는
    MediaPipe 입력에 쓰면 분포가 어긋나므로, 학습·추론 **양쪽**에서 z를 버리는
    모드를 두어 일치시킨다(config의 `zero_depth`). 근본 해법은 원본 영상을
    MediaPipe로 재추출하는 것(`ml/etl/extract_mediapipe.py`).
    """
    feats = np.array(feats, dtype=np.float32, copy=True)
    single = feats.ndim == 1
    if single:
        feats = feats[None, :]
    for block in (POSE_SLICE, LHAND_SLICE, RHAND_SLICE):
        view = feats[:, block].reshape(len(feats), -1, 3)
        view[:, :, 2] = 0.0
        feats[:, block] = view.reshape(len(feats), -1)
    return feats[0] if single else feats
