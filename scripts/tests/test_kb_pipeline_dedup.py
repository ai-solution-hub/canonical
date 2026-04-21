"""Tests for scripts/kb_pipeline/dedup.py content-hash helpers (S183 WP2)."""

import hashlib
import sys
from pathlib import Path

# Allow `from kb_pipeline.dedup import ...` when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kb_pipeline.dedup import (
    DEDUP_MIN_CONTENT_LENGTH,
    normalise_content_for_hash,
)


def _md5(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# normalise_content_for_hash — basic transformations
# ---------------------------------------------------------------------------


def test_empty_returns_empty():
    assert normalise_content_for_hash("") == ""


def test_whitespace_only_returns_empty():
    assert normalise_content_for_hash("   \t\n   ") == ""


def test_lowercases():
    assert normalise_content_for_hash("HELLO World") == "hello world"


def test_strips_punctuation():
    assert normalise_content_for_hash("Hello, World!") == "hello world"


def test_collapses_whitespace():
    assert normalise_content_for_hash("foo   bar\t\tbaz") == "foo bar baz"


def test_preserves_word_characters():
    # Underscores, digits are \w so they survive.
    assert (
        normalise_content_for_hash("version_1_2_3 build 42")
        == "version_1_2_3 build 42"
    )


# ---------------------------------------------------------------------------
# ASCII-only \w parity with JS + PG (S183 WP2a verification M1)
# ---------------------------------------------------------------------------


def test_ascii_only_strips_accented_characters():
    # Python 3 default \w matches Unicode letters, but we configure
    # re.ASCII so the regex matches JS and PG semantics. Accented
    # letters are NOT \w under re.ASCII -> they get stripped by
    # [^\w\s].
    # This test guards against regressions that would cause Python
    # hashes to diverge from PG's content_text_hash generated column.
    accented = "cafeé"  # "cafée" — ASCII "cafe" + acute-e
    result = normalise_content_for_hash(accented)
    # The acute-e is non-ASCII \w, so it's stripped as non-word.
    assert result == "cafe"


def test_ascii_parity_strips_french_word():
    # "société" should normalise to "socit" (e/é stripped; é again
    # non-ASCII \w). Test asserts the ASCII-only shape.
    assert normalise_content_for_hash("Société") == "socit"


# ---------------------------------------------------------------------------
# Parity with PG content_text_hash generated column
# ---------------------------------------------------------------------------


def test_pg_parity_simple_sentence():
    """The PG generated column runs: md5(trim(regexp_replace(
    regexp_replace(lower(trim(content)), '[^\\w\\s]', '', 'g'),
    '\\s+', ' ', 'g'))). Python must produce the same md5 for the
    same input. Known fixture: "Hello, World!" -> "hello world"
    -> md5."""
    expected_hash = _md5("hello world")
    observed = _md5(normalise_content_for_hash("Hello, World!"))
    assert observed == expected_hash


def test_pg_parity_with_punctuation_and_whitespace():
    # Multi-line content with punctuation + tabs + multiple spaces.
    # Expected normalisation:
    #   lowercase -> strip trim
    #   strip non-word/non-space punctuation
    #   collapse whitespace
    raw = "  The Quick, BROWN fox\n\tjumps --over— the lazy dog.  "
    # After lowercase + strip punctuation: "  the quick brown foxntjumps over the lazy dog  "
    # Hmm — "\n" and "\t" are \s so preserved through [^\w\s], then
    # collapsed to single spaces. The em-dash and hyphens are non-word
    # non-space so stripped.
    expected_normalised = "the quick brown fox jumps over the lazy dog"
    assert normalise_content_for_hash(raw) == expected_normalised


# ---------------------------------------------------------------------------
# DEDUP_MIN_CONTENT_LENGTH constant
# ---------------------------------------------------------------------------


def test_min_content_length_is_50():
    """Parity with lib/dedup.ts DEDUP_MIN_CONTENT_LENGTH. Changing this
    in one language without the other would cause subtle soft-block
    divergence between TS and Python entry points."""
    assert DEDUP_MIN_CONTENT_LENGTH == 50
