from fastapi.testclient import TestClient

PROMPT = "Write a short story about a lighthouse keeper."


def generate(client: TestClient, **settings: object) -> dict:
    body = {"prompt": PROMPT, "settings": {"temperature": 0.0, "max_tokens": 30, **settings}}
    res = client.post("/api/generate", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_health_and_config(client: TestClient) -> None:
    health = client.get("/api/health").json()
    assert health["status"] == "ok" and health["demo_mode"] is True
    cfg = client.get("/api/config").json()
    assert cfg["demo_mode"] is True and cfg["provider"] == "mock"
    assert cfg["default_model"] == cfg["models"][0] == "gpt-4o-mini"


def test_generate_returns_tree_with_annotated_root(client: TestClient) -> None:
    tree = generate(client)
    root = tree["nodes"][tree["root_id"]]
    assert tree["prompt"] == PROMPT and tree["provider"] == "mock"
    assert 0 < len(root["tokens"]) <= 30
    tok = root["tokens"][0]
    assert {"token", "logprob", "prob", "entropy", "margin", "top", "is_fork"} <= tok.keys()


def test_max_tokens_is_clamped_to_server_limit(client: TestClient) -> None:
    client.app.state.service.settings.max_tokens_limit = 5  # type: ignore[attr-defined]
    tree = generate(client, max_tokens=50)
    assert len(tree["nodes"][tree["root_id"]]["tokens"]) <= 5


def test_branch_round_trip(client: TestClient) -> None:
    tree = generate(client)
    root = tree["nodes"][tree["root_id"]]
    pos = 2
    alt = next(
        a["token"] for a in root["tokens"][pos]["top"] if a["token"] != root["tokens"][pos]["token"]
    )
    res = client.post(
        "/api/branch",
        json={"tree": tree, "node_id": tree["root_id"], "position": pos, "token": alt},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["created"] is True
    child = body["tree"]["nodes"][body["node_id"]]
    assert child["fork_index"] == pos and child["tokens"][0]["token"] == alt
    assert child["tokens"][0]["forced"] is True
    assert body["node_id"] in body["tree"]["nodes"][tree["root_id"]]["children"]


def test_branch_errors(client: TestClient) -> None:
    tree = generate(client)
    bad_pos = client.post(
        "/api/branch",
        json={"tree": tree, "node_id": tree["root_id"], "position": 999, "token": "x"},
    )
    assert bad_pos.status_code == 422
    bad_node = client.post(
        "/api/branch", json={"tree": tree, "node_id": "nope", "position": 0, "token": "x"}
    )
    assert bad_node.status_code == 422


def test_explore(client: TestClient) -> None:
    tree = generate(client)
    res = client.post(
        "/api/explore", json={"tree": tree, "node_id": tree["root_id"], "top_k": 2, "depth": 2}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["created"]
    assert len(body["tree"]["nodes"]) == 1 + len(body["created"])


def test_compare(client: TestClient) -> None:
    res = client.post(
        "/api/compare",
        json={
            "prompt": PROMPT,
            "a": {"model": "gpt-4o-mini", "temperature": 0.0},
            "b": {"model": "gpt-4o-mini", "temperature": 1.2},
            "max_tokens": 30,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    m = body["metrics"]
    assert 0.0 <= m["position_agreement"] <= 1.0
    assert m["mean_entropy_a"] >= 0
    assert len(body["a"]["tokens"]) > 0 and len(body["b"]["tokens"]) > 0


def test_validation_errors(client: TestClient) -> None:
    assert client.post("/api/generate", json={"prompt": ""}).status_code == 422
    too_hot = {"prompt": "x", "settings": {"temperature": 3}}
    assert client.post("/api/generate", json=too_hot).status_code == 422
    too_many = {"prompt": "x", "settings": {"top_logprobs": 21}}
    assert client.post("/api/generate", json=too_many).status_code == 422


def test_provider_errors_become_502(client: TestClient) -> None:
    from app.providers import ProviderError

    class Failing:
        name = "failing"

        async def complete(self, *args: object, **kwargs: object) -> None:
            raise ProviderError("upstream down")

    client.app.state.service.provider = Failing()  # type: ignore[attr-defined]
    res = client.post("/api/generate", json={"prompt": "x"})
    assert res.status_code == 502 and res.json()["detail"] == "upstream down"
