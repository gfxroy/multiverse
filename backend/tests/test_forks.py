from app.forks import fork_score, is_fork, mark_forks, rank_forks
from app.schemas import ForkSettings

from .conftest import make_token

S = ForkSettings(entropy_threshold=1.5, margin_threshold=0.15, min_alt_prob=0.05)


def test_confident_token_is_not_a_fork() -> None:
    tok = make_token("the", {"the": 0.97, "a": 0.02})
    assert not is_fork(tok, S)
    assert fork_score(tok) < 0.2


def test_close_call_is_a_fork() -> None:
    tok = make_token("cat", {"cat": 0.45, "dog": 0.40, "fox": 0.1})
    assert tok.margin < 0.15
    assert is_fork(tok, S)


def test_high_entropy_is_a_fork_even_with_clear_leader() -> None:
    probs = {"a": 0.3, **{f"t{i}": 0.07 for i in range(10)}}
    tok = make_token("a", probs)
    assert tok.margin > S.margin_threshold
    assert tok.entropy >= S.entropy_threshold
    assert is_fork(tok, S)


def test_implausible_runner_up_blocks_fork() -> None:
    # Very flat tail but the runner-up alone is too unlikely to be worth branching on.
    tok = make_token("a", {"a": 0.2, "b": 0.03, "c": 0.02})
    assert not is_fork(tok, S)


def test_forced_tokens_and_single_alternative_are_never_forks() -> None:
    assert not is_fork(make_token("cat", {"cat": 0.5, "dog": 0.5}, forced=True), S)
    single = make_token("x", {"x": 0.4})
    assert not is_fork(single, S)
    assert fork_score(single) == 0.0


def test_fork_score_orders_by_uncertainty() -> None:
    sure = make_token("a", {"a": 0.9, "b": 0.1})
    torn = make_token("a", {"a": 0.5, "b": 0.49})
    assert fork_score(torn) > fork_score(sure)
    assert 0.0 <= fork_score(sure) <= 1.0 and 0.0 <= fork_score(torn) <= 1.0


def test_mark_and_rank_forks() -> None:
    tokens = [
        make_token("a", {"a": 0.5, "b": 0.45}),
        make_token("c", {"c": 0.99, "d": 0.01}),
        make_token("e", {"e": 0.4, "f": 0.39, "g": 0.2}),
    ]
    mark_forks(tokens, S)
    assert [t.is_fork for t in tokens] == [True, False, True]
    ranked = rank_forks(tokens)
    assert set(ranked) == {0, 2}
    assert tokens[ranked[0]].fork_score >= tokens[ranked[1]].fork_score
    assert rank_forks(tokens, start=1) == [2]
