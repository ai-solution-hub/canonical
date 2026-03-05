"""Tests for template filling -- writing responses into Word documents."""

import pytest
from docx import Document
from docx.shared import Pt, RGBColor
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from fill_template import (
    fill_template,
    _enforce_word_limit,
    _copy_cell_formatting,
    _validate_completed_document,
)


def _create_formatted_template(path: str) -> str:
    """Create a template with specific formatting for testing preservation.

    Returns the path to the created file.
    """
    doc = Document()
    table = doc.add_table(rows=4, cols=2)

    # Header row
    table.rows[0].cells[0].text = "Question"
    table.rows[0].cells[1].text = "Response"

    # Row 1: question with specific font
    q1_para = table.rows[1].cells[0].paragraphs[0]
    q1_run = q1_para.add_run("What is your approach to security?")
    q1_run.font.name = "Arial"
    q1_run.font.size = Pt(11)
    q1_run.font.bold = True
    # Response cell empty

    # Row 2: question with italic
    q2_para = table.rows[2].cells[0].paragraphs[0]
    q2_run = q2_para.add_run("Describe your experience")
    q2_run.font.name = "Arial"
    q2_run.font.size = Pt(11)
    q2_run.font.italic = True
    # Response cell empty

    # Row 3: question with content already
    q3_para = table.rows[3].cells[0].paragraphs[0]
    q3_run = q3_para.add_run("Already filled")
    q3_run.font.name = "Arial"
    q3_run.font.size = Pt(11)
    table.rows[3].cells[1].text = "Existing content"

    doc.save(path)
    return path


class TestFillTemplate:
    """Test the main fill_template function."""

    def test_fills_empty_cell(self):
        """Response text written into empty cell."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": "We use ISO 27001", "word_limit": None}]
                )

                assert result["fields_filled"] == 1
                assert result["fields_failed"] == 0

                # Verify content was written
                doc = Document(output_path)
                cell_text = doc.tables[0].rows[1].cells[1].text.strip()
                assert "ISO 27001" in cell_text
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_preserves_non_filled_cells(self):
        """Cells not in the mapping list remain unchanged."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                # Only fill row 1, leave row 3 (which has content) alone
                fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": "New response", "word_limit": None}]
                )

                doc = Document(output_path)
                # Row 3 should still have original content
                existing = doc.tables[0].rows[3].cells[1].text.strip()
                assert existing == "Existing content"
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_enforces_word_limit(self):
        """Long responses truncated to word limit."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            long_text = " ".join(["word"] * 100)

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": long_text, "word_limit": 10}]
                )

                assert result["fields_filled"] == 1
                assert len(result["truncated"]) == 1
                assert result["truncated"][0]["limit"] == 10
                assert result["truncated"][0]["original_words"] == 100

                # Verify truncated text
                doc = Document(output_path)
                written = doc.tables[0].rows[1].cells[1].text.strip()
                assert len(written.split()) <= 10
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_handles_missing_table(self):
        """Graceful failure when table_index is out of range."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 99, "row_index": 0, "col_index": 0,
                      "response_text": "Text", "word_limit": None}]
                )

                assert result["fields_failed"] == 1
                assert len(result["errors"]) == 1
                assert "out of range" in result["errors"][0]["error"]
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_handles_missing_row(self):
        """Graceful failure when row_index is out of range."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 99, "col_index": 0,
                      "response_text": "Text", "word_limit": None}]
                )

                assert result["fields_failed"] == 1
                assert len(result["errors"]) == 1
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_empty_response_skipped(self):
        """Empty response text results in skip, not fill."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": "", "word_limit": None}]
                )

                assert result["fields_skipped"] == 1
                assert result["fields_filled"] == 0
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_document_unchanged_on_error(self):
        """Original template file is never modified."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            # Get original file contents
            with open(tmp_in.name, "rb") as f:
                original_bytes = f.read()

            try:
                fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": "New content", "word_limit": None}]
                )

                # Verify original was not modified
                with open(tmp_in.name, "rb") as f:
                    after_bytes = f.read()
                assert original_bytes == after_bytes
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)

    def test_multiple_fields_filled(self):
        """Multiple fields can be filled in one call."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                result = fill_template(
                    tmp_in.name, output_path,
                    [
                        {"table_index": 0, "row_index": 1, "col_index": 1,
                         "response_text": "Security response", "word_limit": None},
                        {"table_index": 0, "row_index": 2, "col_index": 1,
                         "response_text": "Experience response", "word_limit": None},
                    ]
                )

                assert result["fields_filled"] == 2
                assert result["fields_failed"] == 0
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)


class TestEnforceWordLimit:
    """Test the word limit enforcement helper."""

    def test_no_limit(self):
        text, truncated = _enforce_word_limit("Hello world", None)
        assert text == "Hello world"
        assert truncated is False

    def test_within_limit(self):
        text, truncated = _enforce_word_limit("one two three", 5)
        assert text == "one two three"
        assert truncated is False

    def test_at_limit(self):
        text, truncated = _enforce_word_limit("one two three", 3)
        assert text == "one two three"
        assert truncated is False

    def test_over_limit(self):
        text, truncated = _enforce_word_limit("one two three four five", 3)
        assert text == "one two three"
        assert truncated is True


class TestValidateCompletedDocument:
    """Test the post-fill validation."""

    def test_identical_documents(self):
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_formatted_template(f.name)
            try:
                warnings = _validate_completed_document(f.name, f.name)
                assert len(warnings) == 0
            finally:
                os.unlink(f.name)

    def test_filled_document_preserves_structure(self):
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp_in:
            _create_formatted_template(tmp_in.name)
            output_path = tmp_in.name.replace(".docx", "_out.docx")

            try:
                fill_template(
                    tmp_in.name, output_path,
                    [{"table_index": 0, "row_index": 1, "col_index": 1,
                      "response_text": "Response", "word_limit": None}]
                )

                warnings = _validate_completed_document(tmp_in.name, output_path)
                assert len(warnings) == 0, f"Unexpected warnings: {warnings}"
            finally:
                os.unlink(tmp_in.name)
                if os.path.exists(output_path):
                    os.unlink(output_path)
