import pytest

from app.compare import divergence_metrics, first_divergence

from .conftest import make_token


def seq(*words: str) -> list:
    return [make_token(w, {w: 0.6, "~": 0.3}) for w in words]


def test_identical_sequences() -> None:
    a = seq("a", "b", "c")
    assert first_divergence(a, seq("a", "b", "c")) is None
    m = divergence_metrics(a, seq("a", "b", "c"))
    assert m.position_agreement == 1.0 and m.shared_prefix_tokens == 3
    assert m.mean_abs_entropy_delta == pytest.approx(0.0)


def test_first_divergence_index() -> None:
    assert first_divergence(seq("a", "b", "c"), seq("a", "x", "c")) == 1
    m = divergence_metrics(seq("a", "b", "c"), seq("a", "x", "c"))
    assert m.shared_prefix_tokens == 1
    assert m.position_agreement == pytest.approx(2 / 3)


def test_prefix_of_other_diverges_at_shorter_length() -> None:
    assert first_divergence(seq("a", "b"), seq("a", "b", "c")) == 2
    m = divergence_metrics(seq("a", "b"), seq("a", "b", "c"))
    assert m.position_agreement == pytest.approx(2 / 3)


def test_empty_sequences() -> None:
    m = divergence_metrics([], [])
    assert m.first_divergence_index is None and m.position_agreement == 1.0
