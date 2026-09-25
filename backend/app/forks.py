"""Fork-point detection: positions where the model was genuinely torn between options."""

from __future__ import annotations

from collections.abc import Sequence

from .entropy import max_entropy
from .schemas import ForkSettings, TokenInfo


def fork_score(token: TokenInfo) -> float:
    """Uncertainty score in [0, 1]: the mean of normalised entropy and (1 - top-2 margin)."""
    if len(token.top) < 2:
        return 0.0
    norm_entropy = min(1.0, token.entropy / max_entropy(len(token.top)))
    return round(0.5 * norm_entropy + 0.5 * (1.0 - token.margin), 6)


def is_fork(token: TokenInfo, settings: ForkSettings) -> bool:
    """A fork needs a plausible runner-up AND either high entropy or a thin top-2 margin.

    Forced tokens are never flagged: that position has already been branched on.
    """
    if token.forced or len(token.top) < 2:
        return False
    if token.top[1].prob < settings.min_alt_prob:
        return False
    return token.entropy >= settings.entropy_threshold or token.margin <= settings.margin_threshold


def mark_forks(tokens: Sequence[TokenInfo], settings: ForkSettings) -> list[TokenInfo]:
    """Annotate tokens in place with ``fork_score`` and ``is_fork``; returns them as a list."""
    for token in tokens:
        token.fork_score = fork_score(token)
        token.is_fork = is_fork(token, settings)
    return list(tokens)


def rank_forks(tokens: Sequence[TokenInfo], start: int = 0) -> list[int]:
    """Indices of fork tokens at or after ``start``, most uncertain first."""
    idx = [i for i in range(start, len(tokens)) if tokens[i].is_fork]
    return sorted(idx, key=lambda i: (-tokens[i].fork_score, i))
