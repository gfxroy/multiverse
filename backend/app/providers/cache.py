"""An in-memory TTL + LRU cache for provider calls, with in-flight request de-duplication."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from ..schemas import GenerationSettings, ProviderResult
from .base import CompletionProvider


@dataclass
class CacheStats:
    hits: int = 0
    misses: int = 0
    size: int = 0


class TTLCache:
    """A small async-safe LRU cache whose entries expire after ``ttl`` seconds."""

    def __init__(self, maxsize: int = 512, ttl: float = 3600.0) -> None:
        self.maxsize = maxsize
        self.ttl = ttl
        self._data: OrderedDict[str, tuple[float, ProviderResult]] = OrderedDict()
        self._inflight: dict[str, asyncio.Future[ProviderResult]] = {}
        self._lock = asyncio.Lock()
        self.stats = CacheStats()

    def _get_fresh(self, key: str) -> ProviderResult | None:
        item = self._data.get(key)
        if item is None:
            return None
        stored_at, value = item
        if self.ttl and time.monotonic() - stored_at > self.ttl:
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return value

    def _put(self, key: str, value: ProviderResult) -> None:
        if self.maxsize <= 0:
            return
        self._data[key] = (time.monotonic(), value)
        self._data.move_to_end(key)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    async def get_or_compute(
        self, key: str, compute: Callable[[], Awaitable[ProviderResult]]
    ) -> tuple[ProviderResult, bool]:
        """Return ``(value, was_cached)``. Concurrent calls with one key share one computation."""
        async with self._lock:
            cached = self._get_fresh(key)
            if cached is not None:
                self.stats.hits += 1
                return cached.model_copy(deep=True), True
            future = self._inflight.get(key)
            owner = future is None
            if future is None:
                future = asyncio.get_running_loop().create_future()
                self._inflight[key] = future
                self.stats.misses += 1
            else:
                self.stats.hits += 1
        if not owner:
            return (await asyncio.shield(future)).model_copy(deep=True), True
        try:
            value = await compute()
        except BaseException as exc:
            async with self._lock:
                self._inflight.pop(key, None)
            future.set_exception(exc)
            future.exception()  # mark retrieved so asyncio doesn't warn when nobody waits
            raise
        async with self._lock:
            self._put(key, value)
            self._inflight.pop(key, None)
            self.stats.size = len(self._data)
        future.set_result(value)
        return value.model_copy(deep=True), False


def cache_key(provider: str, prompt: str, settings: GenerationSettings, prefix: str) -> str:
    payload = json.dumps(
        {"p": provider, "prompt": prompt, "s": settings.model_dump(), "prefix": prefix},
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


class CachedProvider:
    """Wraps a provider so identical requests are served from a :class:`TTLCache`."""

    def __init__(self, inner: CompletionProvider, cache: TTLCache) -> None:
        self.inner = inner
        self.cache = cache
        self.name = inner.name

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        key = cache_key(self.inner.name, prompt, settings, prefix)
        result, _ = await self.cache.get_or_compute(
            key, lambda: self.inner.complete(prompt, settings, prefix)
        )
        return result
