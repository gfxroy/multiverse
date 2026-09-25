"""Completion providers: a real OpenAI-backed one and a deterministic mock for demo mode."""

from .base import CompletionProvider, ProviderError
from .cache import CachedProvider, TTLCache
from .mock import MockProvider
from .openai_provider import OpenAIProvider, build_messages

__all__ = [
    "CachedProvider",
    "CompletionProvider",
    "MockProvider",
    "OpenAIProvider",
    "ProviderError",
    "TTLCache",
    "build_messages",
]
