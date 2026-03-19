"""Tests for extract_docx_tables.py — heading deduplication and table extraction.

Covers the deduplicate_repeated_text() function added to fix pandoc Track Changes
artefacts where heading text is repeated 2-3x across XML text runs.
"""

import sys
import os

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from extract_docx_tables import (
    deduplicate_repeated_text,
    normalize_header,
    detect_table_format,
)


# ── deduplicate_repeated_text ───────────────────────────────────────────


class TestDeduplicateRepeatedText:
    """Tests for the heading deduplication function."""

    def test_tripled_text_no_spaces(self):
        """Tripled text without spaces between repetitions."""
        assert deduplicate_repeated_text(
            "Product SupportProduct SupportProduct Support"
        ) == "Product Support"

    def test_tripled_text_with_trailing_space(self):
        """Tripled text with spaces between repetitions."""
        assert deduplicate_repeated_text(
            "Data Encryption Data Encryption Data Encryption "
        ) == "Data Encryption"

    def test_doubled_text(self):
        """Doubled text should also be deduplicated."""
        assert deduplicate_repeated_text(
            "Software developmentSoftware development"
        ) == "Software development"

    def test_normal_text_unchanged(self):
        """Normal text that is not repeated should pass through unchanged."""
        assert deduplicate_repeated_text(
            "Physical and Environmental Security"
        ) == "Physical and Environmental Security"

    def test_short_text_unchanged(self):
        """Very short text should not be deduplicated (below threshold)."""
        assert deduplicate_repeated_text("abc") == "abc"
        assert deduplicate_repeated_text("ab") == "ab"
        assert deduplicate_repeated_text("") == ""

    def test_single_word_tripled(self):
        """Single word repeated 3x."""
        assert deduplicate_repeated_text("SecuritySecuritySecurity") == "Security"

    def test_text_with_special_chars(self):
        """Text with special characters (slashes, ampersands)."""
        assert deduplicate_repeated_text(
            "Staff / Personnel SecurityStaff / Personnel SecurityStaff / Personnel Security"
        ) == "Staff / Personnel Security"

    def test_text_with_ampersand(self):
        """Text with ampersand repeated."""
        assert deduplicate_repeated_text(
            "Support & SLA StructureSupport & SLA StructureSupport & SLA Structure"
        ) == "Support & SLA Structure"

    def test_non_repeating_similar_text(self):
        """Text that contains similar but non-identical parts should not be changed."""
        text = "Data Security and Data Protection"
        assert deduplicate_repeated_text(text) == text

    def test_five_char_text_not_deduplicated(self):
        """Text shorter than 6 chars is below the minimum threshold."""
        assert deduplicate_repeated_text("abcab") == "abcab"

    def test_quadrupled_text(self):
        """Text repeated 4 times — finds the longest repeating unit (doubled)."""
        # The algorithm finds the longest prefix that repeats to fill the string.
        # For 4x repetition, it first finds the 2x pattern (longest match).
        assert deduplicate_repeated_text("TestTestTestTest") == "TestTest"

    def test_tripled_odd_repetition(self):
        """Text repeated 3 times (not evenly divisible by 2)."""
        assert deduplicate_repeated_text("TestTestTest") == "Test"

    def test_strips_trailing_whitespace(self):
        """Result should have trailing whitespace stripped from the prefix."""
        # "abc abc abc " -> prefix "abc " -> stripped to "abc"
        assert deduplicate_repeated_text("abc abc abc ") == "abc"


# ── normalize_header (existing functionality, regression tests) ─────────


class TestNormalizeHeader:
    """Regression tests for header normalisation."""

    def test_known_mappings(self):
        assert normalize_header("Question") == "question"
        assert normalize_header("Standard Response") == "standard"
        assert normalize_header("Advanced Answer") == "advanced"
        assert normalize_header("Section") == "section"
        assert normalize_header("No.") == "number"

    def test_whitespace_handling(self):
        assert normalize_header("  Question  ") == "question"


# ── detect_table_format (existing functionality, regression tests) ──────


class TestDetectTableFormat:
    """Regression tests for table format detection."""

    def test_audit_6col(self):
        headers = ["No", "Section", "Question", "Standard Response", "Advanced Response", "Notes"]
        assert detect_table_format(headers) == "audit_6col"

    def test_draft_5col(self):
        headers = ["No", "Section", "Question", "Standard Response", "Notes"]
        assert detect_table_format(headers) == "draft_5col"

    def test_unrecognised_returns_none(self):
        headers = ["Foo", "Bar", "Baz"]
        assert detect_table_format(headers) is None
