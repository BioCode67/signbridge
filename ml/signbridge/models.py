"""수어 인식 모델.

설계가 KOREN AI Cloud의 자원 형태(**h200-mig-1g.35gb**)에 맞춰져 있다는 점이 중요하다.
MIG 1g 슬라이스는 메모리는 35GB로 넉넉하지만 **연산 유닛은 H200의 약 1/7**이다.
따라서 원본 RGB 영상을 3D CNN으로 굽는 접근은 이 환경에서 비효율적이고, 랜드마크
시퀀스(프레임당 155 float)를 다루는 소형 트랜스포머가 압도적으로 유리하다.

  - 입력이 영상 대비 약 1/2000 크기 → 데이터 로딩·전처리가 병목이 되지 않는다.
  - 파라미터 3~6M → MIG 슬라이스에서도 에폭이 분 단위.
  - 그대로 ONNX로 내보내 **브라우저에서 실시간 추론**이 가능하다(수 MB).

구조: [B, T, 155] → 속도 특징 결합 → Conv1d 프런트엔드(국소 동작 패턴) →
사인파 위치 인코딩 → Pre-LN 트랜스포머 인코더 → 과제별 헤드.
Conv 프런트엔드를 둔 이유는, 셀프 어텐션이 인접 프레임의 미세한 손 모양 변화를
직접 포착하기엔 비효율적이기 때문이다(음성 인식에서 검증된 조합).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import torch
import torch.nn as nn
import torch.nn.functional as F

from .features import FEATURE_DIM


@dataclass
class ModelConfig:
    feature_dim: int = FEATURE_DIM
    d_model: int = 256
    num_layers: int = 4
    num_heads: int = 8
    ff_dim: int = 512
    dropout: float = 0.1
    use_velocity: bool = True
    conv_stride: int = 1  # CTC 학습 시 2로 두면 시간축이 절반이 되어 빠르다.
    num_classes: int = 0  # 헤드에서 채워진다.
    extra: dict = field(default_factory=dict)


def sinusoidal_positions(length: int, dim: int, device, dtype) -> torch.Tensor:
    """사인파 위치 인코딩. 학습형 임베딩과 달리 학습 때 못 본 길이에도 외삽되므로,
    문장 길이가 제각각인 연속 수어에 적합하다."""
    position = torch.arange(length, device=device, dtype=torch.float32).unsqueeze(1)
    div = torch.exp(
        torch.arange(0, dim, 2, device=device, dtype=torch.float32) * (-math.log(10000.0) / dim)
    )
    encoding = torch.zeros(length, dim, device=device, dtype=torch.float32)
    encoding[:, 0::2] = torch.sin(position * div)
    encoding[:, 1::2] = torch.cos(position * div[: encoding[:, 1::2].shape[1]])
    return encoding.to(dtype)


class SignEncoder(nn.Module):
    """랜드마크 시퀀스 → 문맥 표현 [B, T', d_model]."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        in_dim = cfg.feature_dim * (2 if cfg.use_velocity else 1)

        # Conv 프런트엔드: 국소 시간 패턴 + (선택) 시간축 다운샘플.
        self.frontend = nn.Sequential(
            nn.Conv1d(in_dim, cfg.d_model, kernel_size=5, padding=2, stride=cfg.conv_stride),
            nn.BatchNorm1d(cfg.d_model),
            nn.GELU(),
            nn.Conv1d(cfg.d_model, cfg.d_model, kernel_size=3, padding=1),
            nn.BatchNorm1d(cfg.d_model),
            nn.GELU(),
        )
        self.dropout = nn.Dropout(cfg.dropout)

        layer = nn.TransformerEncoderLayer(
            d_model=cfg.d_model,
            nhead=cfg.num_heads,
            dim_feedforward=cfg.ff_dim,
            dropout=cfg.dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # Pre-LN — warmup 없이도 안정적으로 수렴한다.
        )
        # enable_nested_tensor는 norm_first=True와 함께 쓰이지 않으므로 명시적으로 끈다
        # (켜 두면 매번 경고만 나고 실제로는 적용되지 않는다).
        self.encoder = nn.TransformerEncoder(
            layer, num_layers=cfg.num_layers, enable_nested_tensor=False
        )
        self.norm = nn.LayerNorm(cfg.d_model)

    def output_lengths(self, lengths: torch.Tensor) -> torch.Tensor:
        """Conv stride 적용 후 유효 길이(CTC의 input_lengths 계산용)."""
        stride = self.cfg.conv_stride
        if stride == 1:
            return lengths
        return torch.div(lengths + stride - 1, stride, rounding_mode="floor")

    def forward(self, x: torch.Tensor, padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        """x: [B, T, feature_dim], padding_mask: [B, T] (True = 패딩)."""
        if self.cfg.use_velocity:
            # 1차 차분 = 관절 속도. 수어에서 이동 방향·속도는 그 자체로 의미를 가진다.
            velocity = torch.zeros_like(x)
            velocity[:, 1:] = x[:, 1:] - x[:, :-1]
            x = torch.cat([x, velocity], dim=-1)

        x = self.frontend(x.transpose(1, 2)).transpose(1, 2)  # [B, T', d_model]

        if padding_mask is not None and self.cfg.conv_stride > 1:
            padding_mask = padding_mask[:, :: self.cfg.conv_stride][:, : x.shape[1]]

        x = x + sinusoidal_positions(x.shape[1], x.shape[2], x.device, x.dtype)
        x = self.dropout(x)
        x = self.encoder(x, src_key_padding_mask=padding_mask)
        return self.norm(x)


class AttentivePooling(nn.Module):
    """학습된 질의 벡터로 시간축을 요약. 평균 풀링보다 핵심 수형 구간에 집중한다."""

    def __init__(self, d_model: int):
        super().__init__()
        self.score = nn.Linear(d_model, 1)

    def forward(self, x: torch.Tensor, padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        scores = self.score(x).squeeze(-1)  # [B, T]
        if padding_mask is not None:
            scores = scores.masked_fill(padding_mask, float("-inf"))
        weights = torch.softmax(scores, dim=1).unsqueeze(-1)
        return (x * weights).sum(dim=1)


class IsolatedSignClassifier(nn.Module):
    """단어(글로스) 단위 분류기 — 실시간 자막의 1차 목표."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        self.encoder = SignEncoder(cfg)
        self.pool = AttentivePooling(cfg.d_model)
        self.head = nn.Sequential(
            nn.Dropout(cfg.dropout),
            nn.Linear(cfg.d_model, cfg.d_model),
            nn.GELU(),
            nn.Dropout(cfg.dropout),
            nn.Linear(cfg.d_model, cfg.num_classes),
        )

    def forward(self, x: torch.Tensor, padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        memory = self.encoder(x, padding_mask)
        if padding_mask is not None and self.cfg.conv_stride > 1:
            padding_mask = padding_mask[:, :: self.cfg.conv_stride][:, : memory.shape[1]]
        return self.head(self.pool(memory, padding_mask))


class ContinuousSignRecognizer(nn.Module):
    """연속 수어 → 글로스 시퀀스(CTC). 프레임 단위 정렬 라벨이 없어도 학습된다."""

    def __init__(self, cfg: ModelConfig):
        super().__init__()
        self.cfg = cfg
        self.encoder = SignEncoder(cfg)
        self.head = nn.Linear(cfg.d_model, cfg.num_classes)

    def forward(self, x: torch.Tensor, padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        """반환: [B, T', num_classes] 로짓."""
        return self.head(self.encoder(x, padding_mask))

    def log_probs(self, x: torch.Tensor, padding_mask: torch.Tensor | None = None) -> torch.Tensor:
        return F.log_softmax(self.forward(x, padding_mask), dim=-1)


def make_padding_mask(lengths: torch.Tensor, max_len: int) -> torch.Tensor:
    """길이 벡터 → [B, T] 패딩 마스크(True = 패딩)."""
    positions = torch.arange(max_len, device=lengths.device).unsqueeze(0)
    return positions >= lengths.unsqueeze(1)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
