"""A local stand-in for the Gemini ``generateContent`` endpoint, for end-to-end testing
without a real key. Responses come from the demo MockProvider, reshaped into Gemini's
``logprobsResult`` format (including proto3's habit of omitting zero log-probabilities).

    cd backend && uvicorn tests.fake_gemini:app --port 9100
    GEMINI_BASE_URL=http://127.0.0.1:9100/v1beta GEMINI_API_KEY=fake ...
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException

from app.providers.mock import MockProvider
from app.schemas import GenerationSettings

app = FastAPI(title="fake-gemini")
mock = MockProvider()


def _cand(token: str, logprob: float) -> dict[str, Any]:
    return {"token": token} if logprob == 0.0 else {"token": token, "logProbability": logprob}


@app.post("/v1beta/models/{model}:generateContent")
async def generate(
    model: str, body: dict[str, Any], x_goog_api_key: str = Header(default="")
) -> dict[str, Any]:
    if not x_goog_api_key:
        raise HTTPException(status_code=403, detail="missing key")
    cfg = body.get("generationConfig", {})
    contents = body["contents"]
    prompt = contents[0]["parts"][0]["text"]
    prefix = contents[1]["parts"][0]["text"] if len(contents) > 1 else ""
    settings = GenerationSettings(
        model=model,
        temperature=cfg.get("temperature", 1.0),
        max_tokens=cfg.get("maxOutputTokens", 60),
        top_logprobs=cfg.get("logprobs", 5),
    )
    result = await mock.complete(prompt, settings, prefix)
    return {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [{"text": "".join(t.token for t in result.tokens)}],
                },
                "finishReason": "MAX_TOKENS" if result.finish_reason == "length" else "STOP",
                "logprobsResult": {
                    "chosenCandidates": [_cand(t.token, t.logprob or 0.0) for t in result.tokens],
                    "topCandidates": [
                        {"candidates": [_cand(a.token, a.logprob) for a in t.top]}
                        for t in result.tokens
                    ],
                },
            }
        ],
        "modelVersion": model,
    }
