"""디코딩과 평가 지표.

연속 수어 인식의 표준 지표는 **WER(Word Error Rate)**로, 여기서는 글로스 단위라
문헌에서 흔히 GER/WER로 부른다. 낮을수록 좋고, 삽입 오류 때문에 100%를 넘을 수 있다.
"""

from __future__ import annotations

import torch


def ctc_greedy_decode(
    log_probs: torch.Tensor, input_lengths: torch.Tensor, blank: int = 0
) -> list[list[int]]:
    """[B, T, C] 로그확률 → 배치별 글로스 인덱스 시퀀스.

    CTC 축약 규칙: 연속 중복 제거 후 blank 제거. (빔서치보다 3~5% 정도 나쁘지만
    학습 중 모니터링에는 충분히 빠르고 안정적이다.)
    """
    best = log_probs.argmax(dim=-1)  # [B, T]
    results: list[list[int]] = []
    for row, length in zip(best, input_lengths.tolist()):
        previous = -1
        sequence: list[int] = []
        for token in row[:length].tolist():
            if token != previous and token != blank:
                sequence.append(token)
            previous = token
        results.append(sequence)
    return results


def edit_distance(reference: list[int], hypothesis: list[int]) -> int:
    """레벤슈타인 거리(치환·삽입·삭제 각 비용 1)."""
    if not reference:
        return len(hypothesis)
    if not hypothesis:
        return len(reference)

    previous = list(range(len(hypothesis) + 1))
    for i, ref_token in enumerate(reference, start=1):
        current = [i]
        for j, hyp_token in enumerate(hypothesis, start=1):
            cost = 0 if ref_token == hyp_token else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def word_error_rate(references: list[list[int]], hypotheses: list[list[int]]) -> float:
    total_errors = 0
    total_length = 0
    for reference, hypothesis in zip(references, hypotheses):
        total_errors += edit_distance(reference, hypothesis)
        total_length += len(reference)
    return total_errors / max(1, total_length)


def topk_accuracy(logits: torch.Tensor, targets: torch.Tensor, k: int = 1) -> float:
    k = min(k, logits.shape[-1])
    _, predictions = logits.topk(k, dim=-1)
    hits = (predictions == targets.unsqueeze(-1)).any(dim=-1)
    return hits.float().mean().item()


class AverageMeter:
    def __init__(self) -> None:
        self.total = 0.0
        self.count = 0

    def update(self, value: float, n: int = 1) -> None:
        self.total += value * n
        self.count += n

    @property
    def average(self) -> float:
        return self.total / max(1, self.count)
