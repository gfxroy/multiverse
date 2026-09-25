import math

import pytest

from app.providers.mock import MockProvider, tokenize
from app.schemas import GenerationSettings

PROMPT = "Write a short story about a lighthouse keeper."


def test_tokenize_uses_leading_spaces() -> None:
    assert tokenize("Hello world, again.") == ["Hello", " world", ",", " again", "."]


async def test_mock_is_deterministic(mock_provider: MockProvider) -> None:
    s = GenerationSettings(temperature=0.9, max_tokens=30)
    a = await mock_provider.complete(PROMPT, s)
    b = await mock_provider.complete(PROMPT, s)
    assert [t.token for t in a.tokens] == [t.token for t in b.tokens]
    assert a.method == "mock"


async def test_mock_logprobs_are_well_formed(mock_provider: MockProvider) -> None:
    s = GenerationSettings(temperature=0.7, max_tokens=40, top_logprobs=7)
    r = await mock_provider.complete(PROMPT, s)
    assert 0 < len(r.tokens) <= 40
    for tok in r.tokens:
        assert len(tok.top) == 7
        probs = [a.prob for a in tok.top]
        assert probs == sorted(probs, reverse=True)
        assert sum(probs) <= 1.0 + 1e-9
        assert tok.logprob is not None and tok.logprob <= 0
        assert tok.prob == pytest.approx(math.exp(tok.logprob))
        assert tok.entropy >= 0


async def test_greedy_picks_the_most_likely_token(mock_provider: MockProvider) -> None:
    r = await mock_provider.complete(PROMPT, GenerationSettings(temperature=0.0, max_tokens=25))
    for tok in r.tokens:
        assert tok.token.strip() == tok.top[0].token.strip()


async def test_first_token_has_no_leading_space(mock_provider: MockProvider) -> None:
    r = await mock_provider.complete(PROMPT, GenerationSettings(temperature=0.0, max_tokens=5))
    assert not r.tokens[0].token.startswith(" ")


async def test_prefix_changes_the_continuation(mock_provider: MockProvider) -> None:
    s = GenerationSettings(temperature=0.0, max_tokens=15)
    a = await mock_provider.complete(PROMPT, s, prefix="The old lighthouse")
    b = await mock_provider.complete(PROMPT, s, prefix="The city")
    assert [t.token for t in a.tokens] != [t.token for t in b.tokens]


async def test_model_name_changes_the_distribution(mock_provider: MockProvider) -> None:
    a = await mock_provider.complete(PROMPT, GenerationSettings(model="m1", max_tokens=10))
    b = await mock_provider.complete(PROMPT, GenerationSettings(model="m2", max_tokens=10))
    assert [x.top[0].prob for x in a.tokens] != [x.top[0].prob for x in b.tokens]


async def test_respects_max_tokens(mock_provider: MockProvider) -> None:
    r = await mock_provider.complete(PROMPT, GenerationSettings(max_tokens=3))
    assert len(r.tokens) == 3
    assert r.finish_reason == "length"
