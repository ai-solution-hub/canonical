"""Tests for scripts/dedup_normalise.py — title dedup normalisation (S183 WP2)."""

import sys
from pathlib import Path

# Allow `from dedup_normalise import ...` when the tests run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dedup_normalise import normalise_title_for_dedup


def test_lowercases_input():
    assert normalise_title_for_dedup("FOO BAR") == "foo bar"


def test_strips_leading_the():
    assert (
        normalise_title_for_dedup("The principle of least privilege")
        == "principle of least privilege"
    )


def test_strips_leading_a():
    assert normalise_title_for_dedup("A quick brown fox") == "quick brown fox"


def test_strips_leading_an():
    assert normalise_title_for_dedup("An audit trail") == "audit trail"


def test_strips_every_standalone_article():
    assert normalise_title_for_dedup("The dog and the cat") == "dog and cat"


def test_strips_trailing_question_mark():
    assert normalise_title_for_dedup("Do you comply?") == "do you comply"


def test_strips_trailing_full_stop():
    assert normalise_title_for_dedup("We comply.") == "we comply"


def test_strips_multiple_trailing_punctuation():
    assert normalise_title_for_dedup("Really??  ") == "really"


def test_collapses_internal_whitespace():
    assert normalise_title_for_dedup("  foo    bar    baz  ") == "foo bar baz"


def test_empty_returns_empty():
    assert normalise_title_for_dedup("") == ""


def test_none_returns_empty():
    # Function accepts None as "no input" via truthiness check
    assert normalise_title_for_dedup(None) == ""  # type: ignore[arg-type]


def test_prefixed_article_with_case_differences():
    a = "The GDPR applies?"
    b = "gdpr applies"
    assert normalise_title_for_dedup(a) == normalise_title_for_dedup(b)


def test_s182_regression_mid_sentence_article_collapsed():
    """Mid-sentence articles are stripped so cross-file Q&A variants
    dedup correctly. Matches S183 acceptance."""
    a = "Are access levels granted according to the principle of least privilege?"
    b = "Are access levels granted according to principle of least privilege"
    assert normalise_title_for_dedup(a) == normalise_title_for_dedup(b)
