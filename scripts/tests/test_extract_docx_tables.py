"""Tests for extract_docx_tables.py — heading deduplication and table extraction.

Covers the deduplicate_repeated_text() function added to fix pandoc Track Changes
artefacts where heading text is repeated 2-3x across XML text runs.
Also covers Track Changes safe opening via open_document_safe().
"""

import sys
import os
from unittest.mock import patch, MagicMock

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from extract_docx_tables import (
    deduplicate_repeated_text,
    normalize_header,
    detect_table_format,
    extract_qa_from_docx,
    _cell_markdown,
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


# ── Track Changes safe opening ─────────────────────────────────────────


class TestExtractQaFromDocxTrackChanges:
    """Tests that extract_qa_from_docx uses open_document_safe for TC handling."""

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_uses_open_document_safe(self, mock_open_safe, mock_exists):
        """extract_qa_from_docx should call open_document_safe instead of Document()."""
        # Create a mock document with no body elements
        mock_doc = MagicMock()
        mock_doc.element.body = []
        mock_open_safe.return_value = (mock_doc, None)

        result = extract_qa_from_docx("/fake/path/test.docx")

        mock_open_safe.assert_called_once_with("/fake/path/test.docx")
        assert result == []

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_cleans_up_temp_file(self, mock_open_safe, mock_exists):
        """Temp file from TC resolution should be cleaned up after extraction."""
        mock_doc = MagicMock()
        mock_doc.element.body = []
        temp_path = "/tmp/fake_resolved.docx"
        mock_open_safe.return_value = (mock_doc, temp_path)

        with patch("extract_docx_tables.os.unlink") as mock_unlink:
            extract_qa_from_docx("/fake/path/test.docx")
            mock_unlink.assert_called_once_with(temp_path)

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_no_cleanup_when_no_temp_file(self, mock_open_safe, mock_exists):
        """No cleanup needed when document had no Track Changes."""
        mock_doc = MagicMock()
        mock_doc.element.body = []
        mock_open_safe.return_value = (mock_doc, None)

        with patch("extract_docx_tables.os.unlink") as mock_unlink:
            extract_qa_from_docx("/fake/path/test.docx")
            mock_unlink.assert_not_called()

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_cleans_up_temp_file_on_exception(self, mock_open_safe, mock_exists):
        """Temp file is cleaned up even if extraction raises an exception."""
        mock_doc = MagicMock()
        # Make body iteration raise an exception
        mock_doc.element.body.__iter__ = MagicMock(side_effect=RuntimeError("test error"))
        temp_path = "/tmp/fake_resolved.docx"
        mock_open_safe.return_value = (mock_doc, temp_path)

        with patch("extract_docx_tables.os.unlink") as mock_unlink:
            with pytest.raises(RuntimeError, match="test error"):
                extract_qa_from_docx("/fake/path/test.docx")
            mock_unlink.assert_called_once_with(temp_path)


# ── _cell_markdown (Phase 3 markdown emission) ──────────────────────────


class TestCellMarkdown:
    """Tests for the markdown-emitting cell extraction function."""

    def test_converts_bold_runs(self):
        """Bold runs in a cell become **bold** markdown."""
        mock_cell = MagicMock()
        mock_para = MagicMock()
        mock_para.text = "Important text"
        mock_run = MagicMock()
        mock_run.text = "Important text"
        mock_run.bold = True
        mock_run.italic = False
        mock_para.runs = [mock_run]
        mock_cell.paragraphs = [mock_para]

        result = _cell_markdown(mock_cell)
        assert "**Important text**" in result

    def test_converts_italic_runs(self):
        """Italic runs in a cell become *italic* markdown."""
        mock_cell = MagicMock()
        mock_para = MagicMock()
        mock_para.text = "Emphasised text"
        mock_run = MagicMock()
        mock_run.text = "Emphasised text"
        mock_run.bold = False
        mock_run.italic = True
        mock_para.runs = [mock_run]
        mock_cell.paragraphs = [mock_para]

        result = _cell_markdown(mock_cell)
        assert "*Emphasised text*" in result

    def test_plain_text_fallback(self):
        """Cells with no formatted runs fall back to plain text."""
        mock_cell = MagicMock()
        mock_para = MagicMock()
        mock_para.text = "Plain paragraph"
        mock_para.runs = []
        mock_cell.paragraphs = [mock_para]

        result = _cell_markdown(mock_cell)
        assert "Plain paragraph" in result

    def test_empty_cell_returns_empty(self):
        """Empty cells return an empty string."""
        mock_cell = MagicMock()
        mock_para = MagicMock()
        mock_para.text = ""
        mock_para.runs = []
        mock_cell.paragraphs = [mock_para]

        result = _cell_markdown(mock_cell)
        assert result == ""


# ── emit_markdown parameter ──────────────────────────────────────────────


class TestEmitMarkdownParameter:
    """Tests that the emit_markdown flag is passed through correctly."""

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_emit_markdown_parameter_accepted(self, mock_open_safe, mock_exists):
        """extract_qa_from_docx accepts emit_markdown parameter without error."""
        mock_doc = MagicMock()
        mock_doc.element.body = []
        mock_open_safe.return_value = (mock_doc, None)

        # Should not raise
        result = extract_qa_from_docx("/fake/path/test.docx", emit_markdown=True)
        assert result == []

    @patch("extract_docx_tables.os.path.exists", return_value=True)
    @patch("extract_docx_tables.open_document_safe")
    def test_emit_markdown_default_false(self, mock_open_safe, mock_exists):
        """emit_markdown defaults to False for backwards compatibility."""
        mock_doc = MagicMock()
        mock_doc.element.body = []
        mock_open_safe.return_value = (mock_doc, None)

        # Default call should work (backwards-compatible)
        result = extract_qa_from_docx("/fake/path/test.docx")
        assert result == []
