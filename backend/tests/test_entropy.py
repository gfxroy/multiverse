import math

import pytest

from app.entropy import (
    build_alternatives,
    logprob_to_prob,
    max_entropy,
    tail_mass,
    top2_margin,
    truncated_entropy,
)


def test_entropy_of_certain_distribution_is_zero() -> None:
    assert truncated_entropy([1.0]) == pytest.approx(0.0)


def test_entropy_of_fair_coin_is_one_bit() -> None:
    assert truncated_entropy([0.5, 0.5]) == pytest.approx(1.0)


def test_entropy_uniform_over_four_is_two_bits() -> None:
    assert truncated_entropy([0.25] * 4) == pytest.approx(2.0)


def test_tail_mass_is_counted_as_one_extra_outcome() -> None:
    # 0.5 observed + 0.5 unobserved tail -> behaves like a fair coin.
    assert tail_mass([0.5]) == pytest.approx(0.5)
    assert truncated_entropy([0.5]) == pytest.approx(1.0)
    assert truncated_entropy([0.5], include_tail=False) == pytest.approx(0.5)


def test_truncated_entropy_is_lower_bound_of_full_entropy() -> None:
    full = [0.4, 0.2] + [0.01] * 40
    observed = full[:2]
    h_full = -sum(p * math.log2(p) for p in full)
    assert truncated_entropy(observed) <= h_full


def test_unnormalised_input_is_renormalised() -> None:
    assert truncated_entropy([0.6, 0.6]) == pytest.approx(1.0)


def test_margin() -> None:
    assert top2_margin([0.2, 0.7, 0.1]) == pytest.approx(0.5)
    assert top2_margin([0.9]) == pytest.approx(0.9)
    assert top2_margin([]) == 1.0


def test_max_entropy_includes_tail_bucket() -> None:
    assert max_entropy(1) == pytest.approx(1.0)
    assert max_entropy(3) == pytest.approx(2.0)


def test_logprob_to_prob_is_clamped() -> None:
    assert logprob_to_prob(0.0) == 1.0
    assert logprob_to_prob(1e-9) == 1.0
    assert logprob_to_prob(-9999) == 0.0


def test_build_alternatives_sorts_and_merges_duplicates() -> None:
    alts = build_alternatives([("a", math.log(0.1)), ("b", math.log(0.5)), ("a", math.log(0.2))])
    assert [a.token for a in alts] == ["b", "a"]
    assert alts[1].prob == pytest.approx(0.3)
    assert alts[1].logprob == pytest.approx(math.log(0.3))


def test_build_alternatives_handles_underflow() -> None:
    alts = build_alternatives([("x", -9999.0)])
    assert alts[0].prob == 0.0
    assert math.isfinite(alts[0].logprob)
