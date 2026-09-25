import pytest

from app.ratelimit import Budget, RateLimiter, RateLimitExceeded


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def limiter(calls: int = 3, window: float = 60, cap: int = 0) -> tuple[RateLimiter, Clock]:
    clock = Clock()
    return RateLimiter(calls, window, cap, clock=clock, today=lambda: "2026-09-25"), clock


def test_sliding_window_per_visitor() -> None:
    rl, clock = limiter(calls=3, window=60)
    assert rl.take("a", 2) == 2
    assert rl.remaining("a") == 1
    assert rl.remaining("b") == 3  # visitors are independent
    with pytest.raises(RateLimitExceeded) as info:
        rl.take("a", 2)  # all-or-nothing by default
    assert "rate limit" in info.value.message and info.value.retry_after == 60
    clock.t += 61
    assert rl.remaining("a") == 3


def test_partial_grants_for_auto_explore() -> None:
    rl, _ = limiter(calls=3)
    assert rl.take("a", 5, partial=True) == 3
    with pytest.raises(RateLimitExceeded):
        rl.take("a", 1, partial=True)


def test_global_daily_cap_and_reset() -> None:
    day = {"d": "2026-09-25"}
    rl = RateLimiter(0, 60, 2, clock=Clock(), today=lambda: day["d"])
    rl.take("a", 1)
    rl.take("b", 1)
    with pytest.raises(RateLimitExceeded, match="daily limit"):
        rl.take("c", 1)
    # Own-key requests don't count against the global cap.
    assert rl.take("c", 1, count_global=False) == 1
    day["d"] = "2026-09-26"
    assert rl.take("c", 1) == 1


def test_byok_multiplier() -> None:
    rl, _ = limiter(calls=2)
    assert rl.remaining("a", multiplier=5) == 10


def test_disabled_limiter_and_budget() -> None:
    rl, _ = limiter(calls=0, cap=0)
    assert not rl.enabled
    assert Budget(rl, "a").take(100) == 100
    assert Budget(rl, "a").remaining() is None
    assert Budget(None).take(3) == 3


def test_idle_visitors_are_forgotten() -> None:
    rl, clock = limiter(calls=3, window=10)
    rl.take("a", 1)
    clock.t += 11
    rl.remaining("a")
    assert "a" not in rl._hits
