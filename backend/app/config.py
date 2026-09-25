"""Application settings, loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["auto", "openai", "gemini", "mock"]
ResolvedProvider = Literal["openai", "gemini", "mock"]

# Suggested models per provider. Any model name can still be typed in the UI.
PROVIDER_MODELS: dict[str, list[str]] = {
    "openai": ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o"],
    # Gemini 3.x models no longer return logprobs, so only 2.x models are suggested.
    "gemini": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
}
PROVIDER_MODELS["mock"] = PROVIDER_MODELS["openai"]
DEFAULT_MODELS = PROVIDER_MODELS["openai"]


class Settings(BaseSettings):
    """Runtime configuration.

    ``provider="auto"`` uses OpenAI when ``OPENAI_API_KEY`` is set, otherwise Gemini (native
    API) when ``GEMINI_API_KEY`` is set, and falls back to the deterministic mock provider
    (demo mode) when neither is set.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: SecretStr | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_base_url: str | None = Field(default=None, alias="OPENAI_BASE_URL")
    gemini_api_key: SecretStr | None = Field(default=None, alias="GEMINI_API_KEY")
    gemini_base_url: str = Field(
        default="https://generativelanguage.googleapis.com/v1beta", alias="GEMINI_BASE_URL"
    )

    provider: ProviderName = Field(default="auto", alias="MULTIVERSE_PROVIDER")
    default_model_override: str | None = Field(default=None, alias="MULTIVERSE_DEFAULT_MODEL")
    models_override: list[str] | None = Field(default=None, alias="MULTIVERSE_MODELS")

    cache_size: int = Field(default=512, ge=0, alias="MULTIVERSE_CACHE_SIZE")
    cache_ttl_seconds: float = Field(default=3600.0, ge=0, alias="MULTIVERSE_CACHE_TTL")

    max_tokens_limit: int = Field(default=512, ge=1, alias="MULTIVERSE_MAX_TOKENS_LIMIT")
    max_top_logprobs: int = Field(default=20, ge=1, le=20, alias="MULTIVERSE_MAX_TOP_LOGPROBS")
    max_prompt_chars: int = Field(default=8000, ge=1, alias="MULTIVERSE_MAX_PROMPT_CHARS")
    max_tree_nodes: int = Field(default=300, ge=1, alias="MULTIVERSE_MAX_TREE_NODES")
    max_explore_nodes: int = Field(default=24, ge=1, alias="MULTIVERSE_MAX_EXPLORE_NODES")
    request_timeout_seconds: float = Field(default=60.0, gt=0, alias="MULTIVERSE_REQUEST_TIMEOUT")
    max_concurrency: int = Field(default=4, ge=1, alias="MULTIVERSE_MAX_CONCURRENCY")

    # Public-hosting guards. 0 disables a limit. Limits count *upstream model calls* made
    # with the server's own key; auto-explore counts every branch it spawns.
    rate_limit_calls: int = Field(default=0, ge=0, alias="MULTIVERSE_RATE_LIMIT_CALLS")
    rate_limit_window_seconds: float = Field(
        default=600.0, gt=0, alias="MULTIVERSE_RATE_LIMIT_WINDOW"
    )
    daily_call_cap: int = Field(default=0, ge=0, alias="MULTIVERSE_DAILY_CALL_CAP")
    byok_rate_multiplier: int = Field(default=5, ge=1, alias="MULTIVERSE_BYOK_RATE_MULTIPLIER")
    allow_byok: bool = Field(default=True, alias="MULTIVERSE_ALLOW_BYOK")
    trusted_proxy_hops: int = Field(default=0, ge=0, alias="MULTIVERSE_TRUSTED_PROXY_HOPS")

    static_dir: str | None = Field(default=None, alias="MULTIVERSE_STATIC_DIR")

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        alias="MULTIVERSE_CORS_ORIGINS",
    )

    @staticmethod
    def _has(secret: SecretStr | None) -> bool:
        return bool(secret and secret.get_secret_value().strip())

    @property
    def resolved_provider(self) -> ResolvedProvider:
        """The provider actually in use after resolving ``auto``."""
        if self.provider == "auto":
            if self._has(self.openai_api_key):
                return "openai"
            if self._has(self.gemini_api_key):
                return "gemini"
            return "mock"
        return self.provider

    @property
    def default_model(self) -> str:
        return self.default_model_override or PROVIDER_MODELS[self.resolved_provider][0]

    @property
    def models(self) -> list[str]:
        base = self.models_override or PROVIDER_MODELS[self.resolved_provider]
        return list(dict.fromkeys([self.default_model, *base]))

    @property
    def demo_mode(self) -> bool:
        return self.resolved_provider == "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
