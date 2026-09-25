import asyncio

import pytest

from app.providers import CachedProvider, TTLCache
from app.schemas import GenerationSettings, ProviderResult


class CountingProvider:
    name = "counting"

    def __init__(self, delay: float = 0.0, fail: bool = False) -> None:
        self.calls = 0
        self.delay = delay
        self.fail = fail

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        return ProviderResult(tokens=[], model=settings.model, method="mock")


async def test_identical_requests_hit_the_cache() -> None:
    inner = CountingProvider()
    cached = CachedProvider(inner, TTLCache(10, 60))
    s = GenerationSettings()
    await cached.complete("p", s)
    await cached.complete("p", s)
    await cached.complete("p", s, prefix="x")
    assert inner.calls == 2
    assert cached.cache.stats.hits == 1


async def test_concurrent_identical_requests_are_deduplicated() -> None:
    inner = CountingProvider(delay=0.05)
    cached = CachedProvider(inner, TTLCache(10, 60))
    await asyncio.gather(*(cached.complete("p", GenerationSettings()) for _ in range(5)))
    assert inner.calls == 1


async def test_lru_eviction_and_ttl_expiry() -> None:
    inner = CountingProvider()
    cached = CachedProvider(inner, TTLCache(maxsize=1, ttl=60))
    await cached.complete("a", GenerationSettings())
    await cached.complete("b", GenerationSettings())
    await cached.complete("a", GenerationSettings())
    assert inner.calls == 3

    expiring = CachedProvider(CountingProvider(), TTLCache(maxsize=10, ttl=1e-9))
    await expiring.complete("a", GenerationSettings())
    await asyncio.sleep(0.001)
    await expiring.complete("a", GenerationSettings())
    assert expiring.inner.calls == 2  # type: ignore[attr-defined]


async def test_failures_are_not_cached() -> None:
    inner = CountingProvider(fail=True)
    cached = CachedProvider(inner, TTLCache(10, 60))
    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cached.complete("p", GenerationSettings())
    assert inner.calls == 2


async def test_cached_results_are_isolated_copies() -> None:
    cached = CachedProvider(CountingProvider(), TTLCache(10, 60))
    a = await cached.complete("p", GenerationSettings())
    a.model = "mutated"
    b = await cached.complete("p", GenerationSettings())
    assert b.model != "mutated"
