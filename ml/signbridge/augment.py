"""특징 공간 데이터 증강.

랜드마크를 다시 계산하지 않고 **정규화된 155차원 특징 위에서 직접** 변형한다.
어깨 중점 원점·어깨 너비 스케일 정규화가 이미 끝난 좌표계라, 회전·스케일·평행이동이
모두 단순 선형 연산이다(그리고 CPU 데이터로더에서 충분히 빠르다).

수어 특유의 주의점
  - **좌우 반전은 기본 비활성.** 우세손 전환은 의미를 바꿀 수 있다(왼손잡이 수형 대응이
    목적일 때만 소량 사용).
  - **시간축 뒤집기 금지.** 방향성이 곧 의미인 동작(들어가다/나오다)이 뒤바뀐다.
  - 관절 드롭아웃은 실제 가림(occlusion)·검출 실패를 흉내 내는 가장 효과적인 증강이다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .features import (
    FEATURE_DIM,
    FLAG_SLICE,
    LHAND_SLICE,
    NUM_HAND,
    NUM_POSE,
    POSE_SLICE,
    RHAND_SLICE,
    mirror_features,
)


@dataclass
class AugmentConfig:
    rotate_deg: float = 12.0  # 화면 평면 회전 ±도
    scale: float = 0.15  # 스케일 지터 ±비율
    shift: float = 0.12  # 평행이동 ±(어깨 너비 단위)
    noise: float = 0.01  # 관절별 가우시안 잡음 σ
    joint_dropout: float = 0.05  # 관절 단위 소실 확률
    frame_dropout: float = 0.05  # 프레임 단위 소실 확률(반복 프레임으로 대체)
    hand_dropout: float = 0.03  # 손 전체 소실 확률(검출 실패 모사)
    time_scale: float = 0.2  # 속도 변화 ±비율(리샘플 전 길이 조절)
    mirror_prob: float = 0.0  # 좌우 반전 확률 — 기본 비활성
    enabled: bool = True


def _split_points(feats: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = len(feats)
    pose = feats[:, POSE_SLICE].reshape(n, NUM_POSE, 3)
    left = feats[:, LHAND_SLICE].reshape(n, NUM_HAND, 3)
    right = feats[:, RHAND_SLICE].reshape(n, NUM_HAND, 3)
    return pose, left, right


def augment_sequence(
    feats: np.ndarray, cfg: AugmentConfig, rng: np.random.Generator
) -> np.ndarray:
    """(T, 155) 시퀀스에 증강을 적용한다. 시퀀스 전체에 **동일한** 기하 변환을 건다
    (프레임마다 다른 회전을 걸면 동작이 흔들려 오히려 학습을 방해한다)."""
    if not cfg.enabled:
        return feats

    out = np.array(feats, dtype=np.float32, copy=True)
    if cfg.mirror_prob > 0 and rng.random() < cfg.mirror_prob:
        out = mirror_features(out)

    n = len(out)
    pose, left, right = _split_points(out)
    blocks = (pose, left, right)

    # 1) 화면 평면(x-y) 회전 — 카메라 기울기.
    if cfg.rotate_deg > 0:
        theta = np.deg2rad(rng.uniform(-cfg.rotate_deg, cfg.rotate_deg))
        cos, sin = np.cos(theta), np.sin(theta)
        for block in blocks:
            x = block[:, :, 0].copy()
            y = block[:, :, 1].copy()
            block[:, :, 0] = cos * x - sin * y
            block[:, :, 1] = sin * x + cos * y

    # 2) 스케일 — 체형·카메라 거리 차이(어깨 정규화가 대부분 잡지만 잔차가 남는다).
    if cfg.scale > 0:
        factor = 1.0 + rng.uniform(-cfg.scale, cfg.scale)
        for block in blocks:
            block *= factor

    # 3) 평행이동 — 어깨 검출 원점의 미세 오차.
    if cfg.shift > 0:
        offset = rng.uniform(-cfg.shift, cfg.shift, size=3).astype(np.float32)
        for block in blocks:
            block += offset

    # 4) 관절 잡음.
    if cfg.noise > 0:
        for block in blocks:
            block += rng.normal(0.0, cfg.noise, size=block.shape).astype(np.float32)

    # 5) 관절 드롭아웃 — 가림·검출 실패.
    if cfg.joint_dropout > 0:
        for block in blocks:
            mask = rng.random(block.shape[:2]) < cfg.joint_dropout
            block[mask] = 0.0

    out[:, POSE_SLICE] = pose.reshape(n, -1)
    out[:, LHAND_SLICE] = left.reshape(n, -1)
    out[:, RHAND_SLICE] = right.reshape(n, -1)

    # 6) 손 전체 소실 — 존재 플래그까지 함께 꺼야 실제 미검출과 같은 입력이 된다.
    if cfg.hand_dropout > 0:
        for block_slice, flag_idx in ((LHAND_SLICE, FEATURE_DIM - 2), (RHAND_SLICE, FEATURE_DIM - 1)):
            drop = rng.random(n) < cfg.hand_dropout
            out[drop, block_slice] = 0.0
            out[drop, flag_idx] = 0.0

    # 7) 프레임 드롭아웃 — 프레임 누락 시 브라우저는 직전 특징을 유지하므로 그렇게 모사.
    if cfg.frame_dropout > 0 and n > 1:
        drop = rng.random(n) < cfg.frame_dropout
        drop[0] = False
        for t in np.flatnonzero(drop):
            out[t] = out[t - 1]

    return out


def random_time_crop(
    feats: np.ndarray, cfg: AugmentConfig, rng: np.random.Generator
) -> np.ndarray:
    """리샘플 전에 시간축 길이를 흔들어 수어 속도 편차를 흉내 낸다.

    양 끝을 조금씩 잘라내는 방식이라(중앙 유지) 동작의 핵심 구간은 남는다.
    """
    if not cfg.enabled or cfg.time_scale <= 0 or len(feats) < 8:
        return feats
    n = len(feats)
    keep = 1.0 - rng.uniform(0.0, cfg.time_scale)
    length = max(4, int(round(n * keep)))
    start = rng.integers(0, n - length + 1)
    return feats[start : start + length]
