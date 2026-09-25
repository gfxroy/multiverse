"""Provider interface."""

from __future__ import annotations

import asyncio
from typing import Protocol, runtime_checkable

from ..schemas import GenerationSettings, ProviderResult


class ProviderError(RuntimeError):
    """Raised when the upstream model call fails; surfaced to clients as HTTP 502."""

    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


@runtime_checkable
class CompletionProvider(Protocol):
    """Anything that can produce a completion with per-token top-k logprobs.

    ``prefix`` is assistant text that is already fixed (earlier tokens of the branch plus
    the forced token). Implementations return only the tokens that come *after* it.
    """

    name: str

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult: ...


class ConcurrencyLimited:
    """Caps simultaneous upstream calls (shared across all visitors) with a semaphore."""

    def __init__(self, inner: CompletionProvider, semaphore: asyncio.Semaphore) -> None:
        self.inner = inner
        self.semaphore = semaphore
        self.name = inner.name

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        async with self.semaphore:
            return await self.inner.complete(prompt, settings, prefix)
