"""OpenAI Chat Completions provider.

Root generations are a plain chat request. Branches need the model to continue from
``prefix`` (earlier tokens + the forced token). The Chat Completions API has no native
"prefill the assistant turn" feature, so we use a *continuation prompt*: the partial reply
is sent as a prior assistant message, followed by a short user instruction to continue it
verbatim. See ``docs/branching.md`` for why this is an approximation.
"""

from __future__ import annotations

from typing import Any

from ..entropy import annotate_token, build_alternatives
from ..schemas import GenerationSettings, ProviderResult, TokenInfo
from .base import ProviderError

CONTINUE_INSTRUCTION = (
    "Continue your previous message exactly where it stopped, as if you had never been "
    "interrupted. It may stop mid-sentence or mid-word. Output only the continuation text: "
    "do not repeat any of it, do not restart, and do not comment. If the next word needs a "
    "leading space, include it."
)


def build_messages(
    prompt: str, prefix: str = "", system_prompt: str | None = None
) -> list[dict[str, str]]:
    """Chat messages for a root generation (no prefix) or a branch continuation."""
    messages: list[dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})
    if prefix:
        messages.append({"role": "assistant", "content": prefix})
        messages.append({"role": "user", "content": CONTINUE_INSTRUCTION})
    return messages


def parse_logprobs(content: list[Any] | None) -> list[TokenInfo]:
    """Convert ``choice.logprobs.content`` from the SDK into annotated :class:`TokenInfo`."""
    tokens: list[TokenInfo] = []
    for item in content or []:
        alts = build_alternatives((alt.token, alt.logprob) for alt in (item.top_logprobs or []))
        tokens.append(annotate_token(TokenInfo(token=item.token, logprob=item.logprob, top=alts)))
    return tokens


class OpenAIProvider:
    name = "openai"

    def __init__(self, client: Any) -> None:
        # ``client`` is an ``openai.AsyncOpenAI`` (typed as Any so tests can pass a fake).
        self.client = client

    async def complete(
        self, prompt: str, settings: GenerationSettings, prefix: str = ""
    ) -> ProviderResult:
        import openai

        messages = build_messages(prompt, prefix, settings.system_prompt)
        try:
            response = await self.client.chat.completions.create(
                model=settings.model,
                messages=messages,
                temperature=settings.temperature,
                max_completion_tokens=settings.max_tokens,
                logprobs=True,
                top_logprobs=settings.top_logprobs,
            )
        except openai.APIStatusError as exc:
            status = 429 if exc.status_code == 429 else 502
            hint = ""
            if exc.status_code == 400 and "logprobs" in str(exc.message).lower():
                hint = " This endpoint/model does not seem to support logprobs."
            raise ProviderError(
                f"Upstream error {exc.status_code}: {exc.message}{hint}", status_code=status
            ) from exc
        except openai.APIError as exc:
            raise ProviderError(f"OpenAI request failed: {exc}") from exc

        if not response.choices:
            raise ProviderError("OpenAI returned no choices")
        choice = response.choices[0]
        if choice.logprobs is None or choice.logprobs.content is None:
            raise ProviderError(
                f"Model {settings.model!r} returned no logprobs; pick a model that supports them."
            )
        return ProviderResult(
            tokens=parse_logprobs(choice.logprobs.content),
            finish_reason=choice.finish_reason,
            model=response.model or settings.model,
            method="chat-continuation" if prefix else "chat",
        )


def create_openai_provider(
    api_key: str, base_url: str | None, timeout: float, http_client: Any = None
) -> OpenAIProvider:
    from openai import AsyncOpenAI

    return OpenAIProvider(
        AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=timeout, http_client=http_client)
    )
