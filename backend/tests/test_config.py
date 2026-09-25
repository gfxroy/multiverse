from app.config import Settings


def test_auto_provider_falls_back_to_mock_without_key() -> None:
    s = Settings(_env_file=None, OPENAI_API_KEY="")  # type: ignore[call-arg]
    assert s.resolved_provider == "mock" and s.demo_mode


def test_auto_provider_uses_openai_with_key() -> None:
    s = Settings(_env_file=None, OPENAI_API_KEY="sk-test")  # type: ignore[call-arg]
    assert s.resolved_provider == "openai" and not s.demo_mode


def test_explicit_mock_wins_over_key() -> None:
    s = Settings(  # type: ignore[call-arg]
        _env_file=None, OPENAI_API_KEY="sk-test", MULTIVERSE_PROVIDER="mock"
    )
    assert s.demo_mode
