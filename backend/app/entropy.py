"""Information-theoretic helpers for top-k log-probability distributions.

The API only returns the top-k (k <= 20) alternatives at each position, so the full
distribution is unknown. We treat the unobserved probability mass as a single "tail"
bucket. The resulting entropy is a *lower bound* on the true entropy (splitting the
tail into more outcomes can only increase it), which is fine for ranking positions by
uncertainty but should not be read as an exact value.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

from .schemas import Alternative, TokenInfo

_EPS = 1e-12


def logprob_to_prob(logprob: float) -> float:
    """Convert a natural-log probability to a probability, clamped into [0, 1]."""
    return min(1.0, max(0.0, math.exp(logprob)))


def tail_mass(probs: Iterable[float]) -> float:
    """Probability mass not covered by the observed alternatives."""
    return max(0.0, 1.0 - sum(probs))


def truncated_entropy(probs: Sequence[float], include_tail: bool = True) -> float:
    """Shannon entropy in bits of a (possibly truncated) distribution.

    With ``include_tail`` the missing mass ``1 - sum(probs)`` is added as one extra outcome.
    """
    total = sum(p for p in probs if p > 0)
    if total > 1.0 + 1e-6:
        # Numerical noise or an un-normalised input: renormalise.
        probs = [p / total for p in probs]
    h = -sum(p * math.log2(p) for p in probs if p > _EPS)
    if include_tail:
        r = tail_mass(probs)
        if r > _EPS:
            h -= r * math.log2(r)
    return max(0.0, h)


def top2_margin(probs: Sequence[float]) -> float:
    """Difference between the two most likely alternatives (1.0 if only one is known)."""
    ordered = sorted(probs, reverse=True)
    if not ordered:
        return 1.0
    if len(ordered) == 1:
        return ordered[0]
    return ordered[0] - ordered[1]


def max_entropy(k: int) -> float:
    """Maximum entropy (bits) of k observed outcomes plus a tail bucket."""
    return math.log2(max(k, 1) + 1)


def build_alternatives(pairs: Iterable[tuple[str, float]]) -> list[Alternative]:
    """Build a probability-sorted list of alternatives from ``(token, logprob)`` pairs.

    Duplicate token strings (possible when different byte sequences decode the same way)
    are merged by summing their probabilities.
    """
    merged: dict[str, float] = {}
    for token, logprob in pairs:
        merged[token] = merged.get(token, 0.0) + logprob_to_prob(logprob)
    alts = [
        Alternative(token=t, prob=p, logprob=math.log(p) if p > 0 else -9999.0)
        for t, p in merged.items()
    ]
    alts.sort(key=lambda a: a.prob, reverse=True)
    return alts


def annotate_token(token: TokenInfo) -> TokenInfo:
    """Fill ``prob``, ``entropy`` and ``margin`` on a token from its alternatives."""
    probs = [a.prob for a in token.top]
    if token.logprob is not None:
        token.prob = logprob_to_prob(token.logprob)
    if probs:
        token.entropy = truncated_entropy(probs)
        token.margin = top2_margin(probs)
    else:
        token.entropy = 0.0
        token.margin = 1.0
    return token


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0
