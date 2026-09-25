"""Public-hosting features: rate limits, caps, own-key requests, static frontend."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.api import client_ip
from app.config import Settings
from app.main import create_app
from app.providers import MockProvider
from app.service import MultiverseService

PROMPT = "Write a short story about a lighthouse keeper."


def public_settings(**extra: object) -> Settings:
    # A "real" provider configuration (so limits apply) whose calls go to the mock model.
    values: dict[str, object] = {
        "MULTIVERSE_PROVIDER": "gemini",
        "GEMINI_API_KEY": "server-key",
        "MULTIVERSE_RATE_LIMIT_CALLS": 3,
        "MULTIVERSE_RATE_LIMIT_WINDOW": 600,
        **extra,
    }
    return Settings(_env_file=None, **values)  # type: ignore[call-arg, arg-type]


def make_client(settings: Settings) -> TestClient:
    service = MultiverseService(MockProvider(), settings)
    service.provider = service._wrap(MockProvider())
    return TestClient(create_app(settings, service))


def gen(client: TestClient, **headers: str) -> object:
    body = {"prompt": PROMPT, "settings": {"temperature": 0, "max_tokens": 20}}
    return client.post("/api/generate", json=body, headers=headers)


def test_settings_resolve_gemini_defaults() -> None:
    s = public_settings()
    assert s.resolved_provider == "gemini" and not s.demo_mode
    assert s.default_model == "gemini-2.5-flash" and "gemini-2.0-flash" in s.models
    custom = Settings(  # type: ignore[call-arg]
        _env_file=None, OPENAI_API_KEY="k", MULTIVERSE_DEFAULT_MODEL="my-model"
    )
    assert custom.models[0] == "my-model"


def test_per_visitor_rate_limit_returns_friendly_429() -> None:
    client = make_client(public_settings())
    for i in range(3):
        res = gen(client)
        assert res.status_code == 200
        assert res.headers["X-RateLimit-Remaining"] == str(2 - i)
    res = gen(client)
    assert res.status_code == 429
    assert "rate limit" in res.json()["detail"] and int(res.headers["Retry-After"]) > 0
    cfg = client.get("/api/config").json()
    assert cfg["limits"]["remaining"] == 0 and cfg["limits"]["rate_limit_calls"] == 3


def test_explore_counts_every_spawned_call_and_truncates() -> None:
    client = make_client(public_settings())
    tree = gen(client).json()
    res = client.post(
        "/api/explore", json={"tree": tree, "node_id": tree["root_id"], "top_k": 3, "depth": 2}
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["created"]) == 2  # 1 call used by generate, 2 left
    assert body["truncated"] and body["rate_limited"]
    again = client.post("/api/explore", json={"tree": body["tree"], "node_id": tree["root_id"]})
    assert again.status_code == 429


def test_daily_cap() -> None:
    client = make_client(
        public_settings(MULTIVERSE_RATE_LIMIT_CALLS=0, MULTIVERSE_DAILY_CALL_CAP=1)
    )
    assert gen(client).status_code == 200
    res = gen(client)
    assert res.status_code == 429 and "daily limit" in res.json()["detail"]


def test_demo_mode_is_not_rate_limited(settings: Settings) -> None:
    settings.rate_limit_calls = 1
    client = make_client(settings)
    assert all(gen(client).status_code == 200 for _ in range(3))


def test_server_side_caps() -> None:
    client = make_client(
        public_settings(
            MULTIVERSE_RATE_LIMIT_CALLS=0,
            MULTIVERSE_MAX_TOP_LOGPROBS=5,
            MULTIVERSE_MAX_PROMPT_CHARS=10,
            MULTIVERSE_MAX_TREE_NODES=1,
        )
    )
    res = client.post("/api/generate", json={"prompt": "short", "settings": {"top_logprobs": 20}})
    assert res.status_code == 200
    tree = res.json()
    assert tree["settings"]["top_logprobs"] == 5
    assert all(len(t["top"]) <= 5 for t in tree["nodes"][tree["root_id"]]["tokens"])
    assert client.post("/api/generate", json={"prompt": "x" * 11}).status_code == 422
    tree["nodes"]["extra"] = {**tree["nodes"][tree["root_id"]], "id": "extra"}
    res = client.post(
        "/api/branch", json={"tree": tree, "node_id": tree["root_id"], "position": 0, "token": "Q"}
    )
    assert res.status_code == 422 and "too large" in res.json()["detail"]


def test_own_key_requests(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    settings = public_settings(MULTIVERSE_RATE_LIMIT_CALLS=1, MULTIVERSE_DAILY_CALL_CAP=1)
    client = make_client(settings)
    service: MultiverseService = client.app.state.service  # type: ignore[attr-defined]
    seen: list[tuple[str, str, bool]] = []

    def fake_build(name: str, key: str, *, visitor: bool = False):  # type: ignore[no-untyped-def]
        seen.append((name, key, visitor))
        return service._wrap(MockProvider())

    monkeypatch.setattr(service, "build_provider", fake_build)
    headers = {"X-Multiverse-Provider": "openai", "X-Multiverse-Key": "sk-visitor-secret"}
    # Own-key calls skip the daily cap and get a 5x per-visitor allowance.
    for _ in range(3):
        assert gen(client, **headers).status_code == 200
    assert seen[0] == ("openai", "sk-visitor-secret", True)
    assert "sk-visitor-secret" not in caplog.text

    bad = gen(client, **{"X-Multiverse-Provider": "anthropic", "X-Multiverse-Key": "k"})
    assert bad.status_code == 400
    settings.allow_byok = False
    assert gen(client, **headers).status_code == 400


def test_visitor_keys_ignore_custom_base_urls() -> None:
    settings = public_settings(OPENAI_BASE_URL="https://internal.example/v1")
    service = MultiverseService(MockProvider(), settings)
    visitor = service.build_provider("openai", "k", visitor=True)
    server = service.build_provider("openai", "k")
    inner = lambda p: p.inner.inner.client  # Cached -> Limited -> OpenAIProvider  # noqa: E731
    assert "api.openai.com" in str(inner(visitor).base_url)
    assert "internal.example" in str(inner(server).base_url)


def test_client_ip_uses_trusted_proxy_hops() -> None:
    class Req:
        def __init__(self, xff: str) -> None:
            self.headers = {"x-forwarded-for": xff}
            self.client = type("C", (), {"host": "10.0.0.1"})()

    req = Req("1.1.1.1, 203.0.113.7")  # first entry is client-controlled
    assert client_ip(req, 0) == "10.0.0.1"  # type: ignore[arg-type]
    assert client_ip(req, 1) == "203.0.113.7"  # type: ignore[arg-type]
    assert client_ip(req, 5) == "1.1.1.1"  # type: ignore[arg-type]


def test_serves_built_frontend(tmp_path: Path, settings: Settings) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>multiverse</html>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    settings.static_dir = str(tmp_path)
    client = make_client(settings)
    assert "multiverse" in client.get("/").text
    assert "multiverse" in client.get("/some/deep/link").text  # SPA fallback
    assert client.get("/assets/app.js").text == "console.log(1)"
    assert client.get("/favicon.svg").text == "<svg/>"
    assert client.get("/../pyproject.toml").status_code in (200, 404)
    assert "hatchling" not in client.get("/..%2Fpyproject.toml").text
    assert client.get("/api/health").json()["status"] == "ok"
