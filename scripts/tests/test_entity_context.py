"""Unit tests for scripts.cocoindex_pipeline.entity_context.

Verifies byte-parity with lib/entities/entity-context.ts:19 extractEntityContext,
per TECH §P-5 (docs/specs/stage-5-entity-resolution/TECH.md) and PRODUCT Inv-17
(context_snippet computed inside ingest_file via the Python port).

Test cases derived directly from the TypeScript algorithm semantics:
  1. Empty text returns "".
  2. Empty entity_name returns "".
  3. Both empty returns "".
  4. Entity not found returns "".
  5. Entity at index 0 — no leading ellipsis.
  6. Entity at end of text — no trailing ellipsis.
  7. Entity mid-text with both ellipses (text > 2*CONTEXT_RADIUS + entity).
  8. Case-insensitive match preserves original case in the returned snippet.
  9. Idempotent under repeated invocation.
 10. Byte-parity fixture set (5 fixtures, expected strings derived from the
     spec semantics — TS and Python share the same algorithm verbatim).
"""

from __future__ import annotations

import pytest

from scripts.cocoindex_pipeline.entity_context import (
    CONTEXT_RADIUS,
    extract_entity_context,
)


# --------------------------------------------------------------------- #
# Empty-input edge cases                                                #
# --------------------------------------------------------------------- #


def test_empty_text_returns_empty_string() -> None:
    assert extract_entity_context("", "Hello") == ""


def test_empty_entity_name_returns_empty_string() -> None:
    assert extract_entity_context("Some long text here", "") == ""


def test_both_empty_returns_empty_string() -> None:
    assert extract_entity_context("", "") == ""


def test_returns_str_not_none_when_entity_missing() -> None:
    # Per TECH §P-5 the Python port returns str (not Optional[str]) — empty
    # string in lieu of None to satisfy Inv-17 column-NOT-NULL semantics.
    result = extract_entity_context("foo bar baz", "absent")
    assert result == ""
    assert isinstance(result, str)
    assert result is not None


# --------------------------------------------------------------------- #
# Positional cases — start / end / mid                                   #
# --------------------------------------------------------------------- #


def test_entity_at_start_of_short_text_no_leading_ellipsis() -> None:
    # idx = 0 → start = max(0, 0-80) = 0 → start>0 false → no leading "...".
    # end = min(11, 0+5+80) = 11 → end<11 false → no trailing "...".
    assert extract_entity_context("Hello world", "Hello") == "Hello world"


def test_entity_at_end_of_short_text_no_trailing_ellipsis() -> None:
    # text = "The world Hello" (len 15), entity "Hello" at idx 10.
    # start = max(0, 10-80) = 0, end = min(15, 10+5+80) = 15.
    # Both bounds clamp to text edges → no ellipsis on either side.
    assert extract_entity_context("The world Hello", "Hello") == "The world Hello"


def test_entity_mid_text_emits_both_ellipses() -> None:
    # Text long enough for both bounds to fall inside the string:
    # 100 'a' chars + "TARGET" (6 chars) + 100 'b' chars = len 206.
    # idx = 100, start = max(0, 100-80) = 20, end = min(206, 100+6+80) = 186.
    # snippet = text[20:186] = ("a"*80) + "TARGET" + ("b"*80), strip is noop.
    # start>0 → leading "..."; end<206 → trailing "...".
    text = ("a" * 100) + "TARGET" + ("b" * 100)
    expected = "..." + ("a" * 80) + "TARGET" + ("b" * 80) + "..."
    assert extract_entity_context(text, "TARGET") == expected


def test_entity_mid_text_only_leading_ellipsis_when_end_clamped() -> None:
    # Entity near the end of a long string: start inside text, end clamped.
    # Text: 100 'a' chars + "TARGET" — len 106. idx=100, start=20, end=min(106,186)=106.
    # snippet = text[20:106] = ("a"*80) + "TARGET", start>0 → leading "...",
    # end<106 false → no trailing "...".
    text = ("a" * 100) + "TARGET"
    expected = "..." + ("a" * 80) + "TARGET"
    assert extract_entity_context(text, "TARGET") == expected


def test_entity_mid_text_only_trailing_ellipsis_when_start_clamped() -> None:
    # Entity near the start of a long string: start clamped, end inside text.
    # Text: "TARGET" + 100 'b' chars — len 106. idx=0, start=max(0,-80)=0,
    # end=min(106,0+6+80)=86. snippet=text[0:86]="TARGET"+("b"*80), strip noop.
    # start>0 false → no leading "..."; end<106 → trailing "...".
    text = "TARGET" + ("b" * 100)
    expected = "TARGET" + ("b" * 80) + "..."
    assert extract_entity_context(text, "TARGET") == expected


# --------------------------------------------------------------------- #
# Case-insensitive matching                                              #
# --------------------------------------------------------------------- #


def test_case_insensitive_match_preserves_original_case() -> None:
    # Entity "iso 27001" (lower) found in text "the ISO 27001 standard..."
    # at idx=4 in lowercased text. Slice is taken from the ORIGINAL text,
    # so original case ("ISO 27001") is preserved in the snippet.
    text = "the ISO 27001 standard is widely used"
    result = extract_entity_context(text, "iso 27001")
    assert "ISO 27001" in result  # original case preserved
    assert result == "the ISO 27001 standard is widely used"


def test_case_insensitive_match_mixed_case_entity() -> None:
    text = "Reference to AcMe Corporation appears here."
    result = extract_entity_context(text, "ACME CORPORATION")
    # idx of "acme corporation" in lower → 13. text len 43, start=0, end=43.
    assert result == "Reference to AcMe Corporation appears here."


# --------------------------------------------------------------------- #
# Idempotency                                                            #
# --------------------------------------------------------------------- #


def test_idempotent_under_repeated_invocation() -> None:
    text = "Some text mentioning Acme Ltd in the middle of a sentence."
    entity = "Acme Ltd"
    first = extract_entity_context(text, entity)
    for _ in range(10):
        assert extract_entity_context(text, entity) == first


# --------------------------------------------------------------------- #
# strip() behaviour on slice                                             #
# --------------------------------------------------------------------- #


def test_strip_applied_to_slice_before_ellipsis_decoration() -> None:
    # Text begins with whitespace; entity at idx 2 (after "  ").
    # start = max(0, 2-80) = 0 → start>0 false → no leading "...".
    # snippet = "  Hello world".strip() = "Hello world".
    text = "  Hello world"
    assert extract_entity_context(text, "Hello") == "Hello world"


# --------------------------------------------------------------------- #
# Byte-parity fixture set vs lib/entities/entity-context.ts:19          #
# --------------------------------------------------------------------- #
# Expected outputs derived from the TypeScript algorithm semantics
# (TS source and Python port share the algorithm verbatim per TECH §P-5).


BYTE_PARITY_FIXTURES = [
    # 1. Entity at start, short text → no ellipses.
    ("Hello world", "Hello", "Hello world"),
    # 2. Entity at end, short text → no ellipses.
    ("The world Hello", "Hello", "The world Hello"),
    # 3. Entity mid-text, both ellipses (long enough text both sides).
    (
        ("a" * 100) + "TARGET" + ("b" * 100),
        "TARGET",
        "..." + ("a" * 80) + "TARGET" + ("b" * 80) + "...",
    ),
    # 4. Entity not found → empty string.
    ("Hello world", "xyz", ""),
    # 5. Case-insensitive standard reference (real-world flavour).
    (
        "the ISO 27001 standard is widely used",
        "iso 27001",
        "the ISO 27001 standard is widely used",
    ),
]


@pytest.mark.parametrize(
    "text,entity_name,expected", BYTE_PARITY_FIXTURES, ids=[
        "start-no-ellipsis",
        "end-no-ellipsis",
        "mid-both-ellipses",
        "not-found",
        "case-insensitive-standard",
    ],
)
def test_byte_parity_with_typescript_port(
    text: str, entity_name: str, expected: str
) -> None:
    """Each fixture's expected output is the byte-exact TS output.

    The Python port mirrors lib/entities/entity-context.ts:19 algorithm
    line-for-line; any byte divergence here indicates the port has drifted
    from the canonical TS source.
    """
    assert extract_entity_context(text, entity_name) == expected


# --------------------------------------------------------------------- #
# Constant exposure                                                      #
# --------------------------------------------------------------------- #


def test_context_radius_constant_is_80() -> None:
    # Spec-locked at 80 chars per TECH §P-5 and TS source ln 31.
    assert CONTEXT_RADIUS == 80
