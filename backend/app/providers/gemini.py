"""Native Gemini API provider (``models/{model}:generateContent``).

Gemini's OpenAI-compatible endpoint does not accept ``logprobs``/``top_logprobs``, so this
provider talks to the native REST API, which exposes them as
``generationConfig.responseLogprobs`` + ``generationConfig.logprobs`` (1-20) and returns
``candidates[0].logprobsResult`` with ``chosenCandidates`` and ``topCandidates`` per step.

Google documents these fields as deprecated / not returned for Gemini 3.x models, so use a
2.x model such as ``gemini-2.5-flash``.

Branches use the same continuation-prompt strategy as the OpenAI provider (see
``docs/branching.md``).
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from ..entropy import annotate_token, build_alternatives
from ..schemas import GenerationSettings, ProviderResult, TokenInfo
from .base import ProviderError
from .openai_provider import CONTINUE_INSTRUCTION

_FINISH = {"STOP": "stop", "MAX_TOKENS": "length"}
_RETRY_STATUS = {429, 500, 502, 503, 504}


def build_contents(prompt: str, prefix: str = "") -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = [{"role": "user", "parts": [{"text": prompt}]}]
    if prefix:
        contents.append({"role": "model", "parts": [{"text": prefix}]})
        contents.append({"role": "user", "parts": [{"text": CONTINUE_INSTRUCTION}]})
    return contents


def build_request(settings: GenerationSettings, prompt: str, prefix: str = "") -> dict[str, Any]:
    config: dict[str, Any] = {
        "temperature": settings.temperature,
        "maxOutputTokens": settings.max_tokens,
        "responseLogprobs": True,
        "logprobs": settings.top_logprobs,
    }
    # 2.5 Flash models "think" by default, which would spend the output budget on hidden
    # reasoning tokens. A zero budget disables thinking for them (not allowed on 2.5 Pro,
    # and 2.0 models have no thinking config at all).
    if settings.model.startswith("gemini-2.5-flash"):
        config["thinkingConfig"] = {"thinkingBudget": 0}
    body: dict[str, Any] = {
        "contents": build_contents(prompt, prefix),
        "generationConfig": config,
    }
    if settings.system_prompt:
        body["systemInstruction"] = {"parts": [{"text": settings.system_prompt}]}
    return body


def _logprob(item: dict[str, Any]) -> float:
    # proto3 JSON omits fields equal to their default, so a certain token (log p = 0.0) may
    # arrive without ``logProbability``.
    return float(item.get("logProbability", 0.0))


def parse_response(data: dict[str, Any], model: str) -> tuple[list[TokenInfo], str | None]:
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason")
        raise ProviderError(
            f"Gemini returned no candidates{f' (blocked: {reason})' if reason else ''}"
        )
    cand = candidates[0]
    result = cand.get("logprobsResult")
    if not result or "chosenCandidates" not in result:
        raise ProviderError(
            f"Gemini model {model!r} returned no logprobs. Gemini 3.x models no longer "
            "return them; try gemini-2.5-flash."
        )
    chosen = result.get("chosenCandidates") or []
    top = result.get("topCandidates") or []
    tokens: list[TokenInfo] = []
    for i, item in enumerate(chosen):
        alts_raw = top[i].get("candidates", []) if i < len(top) else []
        alts = build_alternatives((a.get("token", ""), _logprob(a)) for a in alts_raw)
        tokens.append(
            annotate_token(TokenInfo(token=item.get("token", ""), logprob=_logprob(item), top=alts))
        )
    finish = cand.get("finishReason")
    return tokens, _FINISH.get(finish, finish.lower() if isinstance(finish, str) else None)


class GeminiProvider:
    name = "gemini"
    DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 60.0,
        max_retries: int = 2,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.client = client or httpx.AsyncClient(timeout=timeout)

    def __repr__(self) -> str:  # never include the key
        return f"GeminiProvider(base_url={self.base_url!r})"

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        url = f"{self.base_url}/models/{settings.model}:generateContent"
        body = build_request(settings, prompt, prefix)
        headers = {"x-goog-api-key": self._api_key, "Content-Type": "application/json"}
        response: httpx.Response | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = await self.client.post(url, json=body, headers=headers)
            except httpx.HTTPError as exc:
                if attempt == self.max_retries:
                    raise ProviderError(f"Gemini request failed: {type(exc).__name__}") from exc
                await asyncio.sleep(0.5 * 2**attempt)
                continue
            if response.status_code in _RETRY_STATUS and attempt < self.max_retries:
                retry_after = response.headers.get("retry-after", "")
                delay = float(retry_after) if retry_after.isdigit() else 0.8 * 2**attempt
                await asyncio.sleep(min(delay, 8.0))
                continue
            break
        assert response is not None
        if response.status_code >= 400:
            raise ProviderError(_error_message(response), status_code=_status(response))
        tokens, finish = parse_response(response.json(), settings.model)
        return ProviderResult(
            tokens=tokens,
            finish_reason=finish,
            model=settings.model,
            method="chat-continuation" if prefix else "chat",
        )


def _status(response: httpx.Response) -> int:
    return 429 if response.status_code == 429 else 502


def _error_message(response: httpx.Response) -> str:
    try:
        message = response.json().get("error", {}).get("message", "")
    except ValueError:
        message = ""
    if response.status_code == 429:
        return "Gemini rate limit or quota exceeded. Wait a minute and try again."
    text = f"Gemini error {response.status_code}: {message or response.reason_phrase}"
    if "logprobs is not enabled" in message.lower():
        text += (
            " (this model or API key can't return logprobs, which Multiverse needs; "
            "try a Gemini 2.x model, or an OpenAI model)"
        )
    return text
