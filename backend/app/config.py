"""Application settings, loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["auto", "openai", "mock"]

DEFAULT_MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o"]


class Settings(BaseSettings):
    """Runtime configuration.

    ``provider="auto"`` uses OpenAI when ``OPENAI_API_KEY`` is set and falls back to the
    deterministic mock provider (demo mode) otherwise.
    """

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: SecretStr | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_base_url: str | None = Field(default=None, alias="OPENAI_BASE_URL")

    provider: ProviderName = Field(default="auto", alias="MULTIVERSE_PROVIDER")
    default_model: str = Field(default="gpt-4o-mini", alias="MULTIVERSE_DEFAULT_MODEL")
    models: list[str] = Field(
        default_factory=lambda: list(DEFAULT_MODELS), alias="MULTIVERSE_MODELS"
    )

    cache_size: int = Field(default=512, ge=0, alias="MULTIVERSE_CACHE_SIZE")
    cache_ttl_seconds: float = Field(default=3600.0, ge=0, alias="MULTIVERSE_CACHE_TTL")

    max_tokens_limit: int = Field(default=512, ge=1, alias="MULTIVERSE_MAX_TOKENS_LIMIT")
    max_explore_nodes: int = Field(default=24, ge=1, alias="MULTIVERSE_MAX_EXPLORE_NODES")
    request_timeout_seconds: float = Field(default=60.0, gt=0, alias="MULTIVERSE_REQUEST_TIMEOUT")

    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"],
        alias="MULTIVERSE_CORS_ORIGINS",
    )

    @property
    def resolved_provider(self) -> Literal["openai", "mock"]:
        """The provider actually in use after resolving ``auto``."""
        if self.provider == "auto":
            key = self.openai_api_key.get_secret_value().strip() if self.openai_api_key else ""
            return "openai" if key else "mock"
        return self.provider

    @property
    def demo_mode(self) -> bool:
        return self.resolved_provider == "mock"


@lru_cache
def get_settings() -> Settings:
    return Settings()
