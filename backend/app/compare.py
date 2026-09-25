"""Divergence metrics between two completions of the same prompt."""

from __future__ import annotations

from .entropy import mean
from .schemas import DivergenceMetrics, TokenInfo


def first_divergence(a: list[TokenInfo], b: list[TokenInfo]) -> int | None:
    """Index of the first differing token; ``None`` if the sequences are identical."""
    for i, (ta, tb) in enumerate(zip(a, b, strict=False)):
        if ta.token != tb.token:
            return i
    return None if len(a) == len(b) else min(len(a), len(b))


def divergence_metrics(a: list[TokenInfo], b: list[TokenInfo]) -> DivergenceMetrics:
    first = first_divergence(a, b)
    aligned = min(len(a), len(b))
    longest = max(len(a), len(b))
    agree = sum(1 for ta, tb in zip(a, b, strict=False) if ta.token == tb.token)
    deltas = [abs(ta.entropy - tb.entropy) for ta, tb in zip(a, b, strict=False)]
    return DivergenceMetrics(
        first_divergence_index=first,
        shared_prefix_tokens=aligned if first is None else first,
        position_agreement=agree / longest if longest else 1.0,
        mean_entropy_a=mean([t.entropy for t in a]),
        mean_entropy_b=mean([t.entropy for t in b]),
        mean_abs_entropy_delta=mean(deltas) if aligned else 0.0,
        fork_points_a=sum(t.is_fork for t in a),
        fork_points_b=sum(t.is_fork for t in b),
    )
