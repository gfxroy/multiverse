from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.entropy import annotate_token
from app.main import create_app
from app.providers import CachedProvider, MockProvider, TTLCache
from app.schemas import Alternative, GenerationSettings, TokenInfo
from app.service import MultiverseService


def make_token(token: str, probs: dict[str, float], forced: bool = False) -> TokenInfo:
    """Build an annotated token whose alternatives have the given probabilities."""
    import math

    top = sorted(
        (Alternative(token=t, prob=p, logprob=math.log(p)) for t, p in probs.items()),
        key=lambda a: a.prob,
        reverse=True,
    )
    lp = math.log(probs[token]) if token in probs else None
    return annotate_token(TokenInfo(token=token, logprob=lp, top=top, forced=forced))


@pytest.fixture
def settings() -> Settings:
    return Settings(MULTIVERSE_PROVIDER="mock", _env_file=None)  # type: ignore[call-arg]


@pytest.fixture
def mock_provider() -> MockProvider:
    return MockProvider(latency=0.0)


@pytest.fixture
def gen_settings() -> GenerationSettings:
    return GenerationSettings(model="gpt-4o-mini", temperature=0.0, max_tokens=40, top_logprobs=10)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    service = MultiverseService(CachedProvider(MockProvider(), TTLCache(64, 60)), settings)
    return TestClient(create_app(settings, service))
