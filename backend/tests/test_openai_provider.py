"""The OpenAI provider is tested against a fake client: no network, no API key."""

from types import SimpleNamespace
from typing import Any

import pytest

from app.providers import OpenAIProvider, ProviderError, build_messages
from app.providers.openai_provider import CONTINUE_INSTRUCTION
from app.schemas import GenerationSettings


def lp(token: str, logprob: float, top: list[tuple[str, float]]) -> SimpleNamespace:
    return SimpleNamespace(
        token=token,
        logprob=logprob,
        top_logprobs=[SimpleNamespace(token=t, logprob=v) for t, v in top],
    )


class FakeCompletions:
    def __init__(self, content: list[Any] | None) -> None:
        self.content = content
        self.kwargs: dict[str, Any] = {}

    async def create(self, **kwargs: Any) -> SimpleNamespace:
        self.kwargs = kwargs
        logprobs = None if self.content is None else SimpleNamespace(content=self.content)
        choice = SimpleNamespace(logprobs=logprobs, finish_reason="stop")
        return SimpleNamespace(choices=[choice], model="gpt-4o-mini-2024-07-18")


def fake_client(content: list[Any] | None) -> SimpleNamespace:
    return SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(content)))


def test_root_messages() -> None:
    assert build_messages("hi") == [{"role": "user", "content": "hi"}]
    assert build_messages("hi", system_prompt="be terse")[0] == {
        "role": "system",
        "content": "be terse",
    }


def test_continuation_messages_put_prefix_in_assistant_turn() -> None:
    msgs = build_messages("hi", prefix="Hello the")
    assert msgs[1] == {"role": "assistant", "content": "Hello the"}
    assert msgs[2] == {"role": "user", "content": CONTINUE_INSTRUCTION}


async def test_request_parameters_and_parsing() -> None:
    client = fake_client(
        [
            lp("Hello", -0.1, [("Hello", -0.1), ("Hi", -2.5)]),
            lp(" world", -0.7, [(" world", -0.7), (" there", -0.9)]),
        ]
    )
    provider = OpenAIProvider(client)
    s = GenerationSettings(model="gpt-4o-mini", temperature=0.3, max_tokens=12, top_logprobs=5)
    result = await provider.complete("Say hi", s)
    kwargs = client.chat.completions.kwargs
    assert kwargs["logprobs"] is True and kwargs["top_logprobs"] == 5
    assert kwargs["max_completion_tokens"] == 12 and kwargs["temperature"] == 0.3
    assert result.method == "chat" and result.model.startswith("gpt-4o-mini")
    assert [t.token for t in result.tokens] == ["Hello", " world"]
    assert result.tokens[1].margin == pytest.approx(0.4966 - 0.4066, abs=1e-3)
    assert result.tokens[1].entropy > result.tokens[0].entropy


async def test_continuation_marks_method() -> None:
    provider = OpenAIProvider(fake_client([lp("x", -0.1, [("x", -0.1)])]))
    result = await provider.complete("p", GenerationSettings(), prefix="abc")
    assert result.method == "chat-continuation"


async def test_missing_logprobs_raises_provider_error() -> None:
    provider = OpenAIProvider(fake_client(None))
    with pytest.raises(ProviderError, match="no logprobs"):
        await provider.complete("p", GenerationSettings(model="o3"))
