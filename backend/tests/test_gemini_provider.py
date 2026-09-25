"""Native Gemini provider, exercised against httpx.MockTransport (no network, no key)."""

import json
from typing import Any

import httpx
import pytest

from app.providers import GeminiProvider, ProviderError
from app.providers.gemini import build_request, parse_response
from app.providers.openai_provider import CONTINUE_INSTRUCTION
from app.schemas import GenerationSettings

GOOD = {
    "candidates": [
        {
            "content": {"parts": [{"text": "Hello world"}], "role": "model"},
            "finishReason": "STOP",
            "logprobsResult": {
                "topCandidates": [
                    {
                        "candidates": [
                            {"token": "Hello", "logProbability": -0.1},
                            {"token": "Hi", "logProbability": -2.5},
                        ]
                    },
                    # proto3 JSON omits logProbability when it is exactly 0.0
                    {
                        "candidates": [
                            {"token": " world"},
                            {"token": " there", "logProbability": -9.0},
                        ]
                    },
                ],
                "chosenCandidates": [
                    {"token": "Hello", "logProbability": -0.1},
                    {"token": " world"},
                ],
            },
        }
    ],
    "modelVersion": "gemini-2.5-flash",
}


def make_provider(handler: Any, retries: int = 2) -> GeminiProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return GeminiProvider(
        "test-key", "https://example.test/v1beta", client=client, max_retries=retries
    )


def test_request_shape_for_root_and_branch() -> None:
    s = GenerationSettings(model="gemini-2.5-flash", temperature=0.4, max_tokens=33, top_logprobs=7)
    root = build_request(s, "Say hi")
    cfg = root["generationConfig"]
    assert cfg["responseLogprobs"] is True and cfg["logprobs"] == 7
    assert cfg["maxOutputTokens"] == 33 and cfg["temperature"] == 0.4
    assert cfg["thinkingConfig"] == {"thinkingBudget": 0}
    assert root["contents"] == [{"role": "user", "parts": [{"text": "Say hi"}]}]

    branch = build_request(
        s.model_copy(update={"model": "gemini-2.0-flash"}), "Say hi", "Hello the"
    )
    assert "thinkingConfig" not in branch["generationConfig"]
    assert branch["contents"][1] == {"role": "model", "parts": [{"text": "Hello the"}]}
    assert branch["contents"][2]["parts"][0]["text"] == CONTINUE_INSTRUCTION

    with_system = build_request(s.model_copy(update={"system_prompt": "be terse"}), "x")
    assert with_system["systemInstruction"] == {"parts": [{"text": "be terse"}]}


def test_parse_handles_missing_logprob_fields() -> None:
    tokens, finish = parse_response(GOOD, "gemini-2.5-flash")
    assert [t.token for t in tokens] == ["Hello", " world"]
    assert finish == "stop"
    assert tokens[1].logprob == 0.0 and tokens[1].prob == pytest.approx(1.0)
    assert tokens[1].top[0].token == " world"


def test_parse_errors() -> None:
    no_logprobs = {"candidates": [{"content": {"parts": [{"text": "x"}]}, "finishReason": "STOP"}]}
    with pytest.raises(ProviderError, match="no logprobs"):
        parse_response(no_logprobs, "gemini-3-flash")
    with pytest.raises(ProviderError, match="blocked: SAFETY"):
        parse_response({"promptFeedback": {"blockReason": "SAFETY"}}, "m")


async def test_complete_sends_key_in_header_not_url() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=GOOD)

    result = await make_provider(handler).complete(
        "Say hi", GenerationSettings(model="gemini-2.5-flash")
    )
    assert seen["url"] == "https://example.test/v1beta/models/gemini-2.5-flash:generateContent"
    assert seen["key"] == "test-key" and "test-key" not in seen["url"]
    assert result.method == "chat" and len(result.tokens) == 2
    assert "test-key" not in repr(make_provider(handler))


async def test_retries_rate_limits_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.providers.gemini.asyncio.sleep", no_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, json={"error": {"message": "quota"}})
        return httpx.Response(200, json=GOOD)

    result = await make_provider(handler).complete("p", GenerationSettings(), prefix="Hi")
    assert calls["n"] == 3 and result.method == "chat-continuation"


async def test_errors_map_to_provider_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    async def no_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.providers.gemini.asyncio.sleep", no_sleep)

    def limited(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "quota"}})

    with pytest.raises(ProviderError) as info:
        await make_provider(limited, retries=1).complete("p", GenerationSettings())
    assert info.value.status_code == 429

    def bad_key(_: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "API key not valid."}})

    with pytest.raises(ProviderError, match="API key not valid") as info:
        await make_provider(bad_key).complete("p", GenerationSettings())
    assert info.value.status_code == 502
