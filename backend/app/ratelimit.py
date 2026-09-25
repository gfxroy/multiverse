"""In-memory rate limiting for public deployments.

Two independent limits, both counted in *upstream model calls*:

* a sliding-window limit per visitor (client IP), and
* a global daily cap across all visitors (resets at UTC midnight).

Requests made with a visitor's own API key skip the global cap and get a larger per-IP
allowance (``byok_rate_multiplier``). State is per process, which is fine for a single
container such as a Hugging Face Space. Use Redis or similar if you run several replicas.
"""

from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta


class RateLimitExceeded(Exception):
    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = max(1, retry_after)


def _utc_today() -> str:
    return datetime.now(UTC).date().isoformat()


def _seconds_to_utc_midnight() -> int:
    now = datetime.now(UTC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((tomorrow - now).total_seconds()) + 1


@dataclass
class RateLimiter:
    calls: int  # per window per visitor; 0 = unlimited
    window: float
    daily_cap: int  # global; 0 = unlimited
    clock: Callable[[], float] = time.monotonic
    today: Callable[[], str] = _utc_today
    _hits: dict[str, deque[float]] = field(default_factory=dict)
    _day: str = ""
    _day_count: int = 0

    @property
    def enabled(self) -> bool:
        return self.calls > 0 or self.daily_cap > 0

    def _prune(self, key: str) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            return deque()
        cutoff = self.clock() - self.window
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if not hits:
            del self._hits[key]  # drop idle visitors so memory stays bounded
        return hits

    def _roll_day(self) -> None:
        today = self.today()
        if today != self._day:
            self._day, self._day_count = today, 0

    def remaining(self, key: str, multiplier: int = 1, count_global: bool = True) -> int | None:
        """Calls this visitor may still make right now (None = unlimited)."""
        limits: list[int] = []
        if self.calls:
            limits.append(self.calls * multiplier - len(self._prune(key)))
        if self.daily_cap and count_global:
            self._roll_day()
            limits.append(self.daily_cap - self._day_count)
        return max(0, min(limits)) if limits else None

    def take(
        self,
        key: str,
        n: int,
        *,
        multiplier: int = 1,
        count_global: bool = True,
        partial: bool = False,
    ) -> int:
        """Consume up to ``n`` calls. Raises if nothing (or, unless ``partial``, not all) fits."""
        available = self.remaining(key, multiplier, count_global)
        granted = n if available is None else min(n, available)
        if granted <= 0 or (granted < n and not partial):
            raise self._exceeded(key, multiplier, count_global)
        now = self.clock()
        if self.calls:
            self._hits.setdefault(key, deque()).extend([now] * granted)
        if self.daily_cap and count_global:
            self._day_count += granted
        return granted

    def _exceeded(self, key: str, multiplier: int, count_global: bool) -> RateLimitExceeded:
        self._roll_day()
        if self.daily_cap and count_global and self._day_count >= self.daily_cap:
            return RateLimitExceeded(
                "The live demo has reached its daily limit. Try again tomorrow, or add "
                "your own API key in the key menu to keep exploring.",
                _seconds_to_utc_midnight(),
            )
        hits = self._prune(key)
        wait = math.ceil(hits[0] + self.window - self.clock()) if hits else 1
        minutes = max(1, math.ceil(wait / 60))
        return RateLimitExceeded(
            f"You've hit the rate limit ({self.calls * multiplier} model calls per "
            f"{int(self.window // 60)} min). Try again in about {minutes} min, or use your "
            "own API key.",
            wait,
        )


@dataclass(frozen=True)
class Budget:
    """A single request's view of the limiter."""

    limiter: RateLimiter | None
    key: str = "anonymous"
    multiplier: int = 1
    count_global: bool = True

    def take(self, n: int, partial: bool = False) -> int:
        if self.limiter is None or not self.limiter.enabled or n <= 0:
            return n
        return self.limiter.take(
            self.key,
            n,
            multiplier=self.multiplier,
            count_global=self.count_global,
            partial=partial,
        )

    def remaining(self) -> int | None:
        if self.limiter is None or not self.limiter.enabled:
            return None
        return self.limiter.remaining(self.key, self.multiplier, self.count_global)


UNLIMITED = Budget(limiter=None)
