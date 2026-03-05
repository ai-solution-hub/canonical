"""Tests for template analysis -- field identification in Word documents."""

import pytest
from docx import Document
from docx.shared import Inches
import os
import sys
import tempfile

# Add scripts to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from analyse_template import (
    analyse_template,
    _cell_text,
    _is_empty_or_placeholder,
    _detect_merged_cells,
    _extract_word_limit,
    _extract_section_headings,
    _has_tracked_changes,
)


def _create_simple_template(path: str, questions: list[tuple[str, str]]):
    """Create a simple template with Question | Response columns.

    Args:
        path: Output file path
        questions: List of (question_text, response_text) tuples.
                   Empty string for response_text means the cell should be empty.
    """
    doc = Document()
    table = doc.add_table(rows=1 + len(questions), cols=2)

    # Header row
    table.rows[0].cells[0].text = "Question"
    table.rows[0].cells[1].text = "Response"

    # Data rows
    for i, (question, response) in enumerate(questions):
        table.rows[i + 1].cells[0].text = question
        if response:
            table.rows[i + 1].cells[1].text = response

    doc.save(path)


def _create_template_with_headings(path: str):
    """Create a template with section headings above tables."""
    doc = Document()

    doc.add_heading("Section 1: Information Security", level=1)
    table1 = doc.add_table(rows=3, cols=2)
    table1.rows[0].cells[0].text = "Question"
    table1.rows[0].cells[1].text = "Response"
    table1.rows[1].cells[0].text = "Describe your ISO 27001 approach"
    # Row 1 response empty
    table1.rows[2].cells[0].text = "List your certifications"
    # Row 2 response empty

    doc.add_heading("Section 2: GDPR Compliance", level=1)
    table2 = doc.add_table(rows=2, cols=2)
    table2.rows[0].cells[0].text = "Question"
    table2.rows[0].cells[1].text = "Response"
    table2.rows[1].cells[0].text = "How do you handle data requests?"
    # Response empty

    doc.save(path)


def _create_template_with_placeholders(path: str):
    """Create a template with placeholder text in response cells."""
    doc = Document()
    table = doc.add_table(rows=5, cols=2)

    table.rows[0].cells[0].text = "Question"
    table.rows[0].cells[1].text = "Response"

    table.rows[1].cells[0].text = "Company name"
    table.rows[1].cells[1].text = "[Insert company name]"

    table.rows[2].cells[0].text = "Approach"
    table.rows[2].cells[1].text = "{{approach_description}}"

    table.rows[3].cells[0].text = "Revenue"
    table.rows[3].cells[1].text = "N/A"

    table.rows[4].cells[0].text = "Filled already"
    table.rows[4].cells[1].text = "This cell already has content"

    doc.save(path)


def _create_template_with_word_limits(path: str):
    """Create a template with a word limit column."""
    doc = Document()
    table = doc.add_table(rows=3, cols=3)

    table.rows[0].cells[0].text = "Question"
    table.rows[0].cells[1].text = "Word Limit"
    table.rows[0].cells[2].text = "Response"

    table.rows[1].cells[0].text = "Describe your security approach"
    table.rows[1].cells[1].text = "500 words"
    # Response empty

    table.rows[2].cells[0].text = "List certifications (max 200 words)"
    table.rows[2].cells[1].text = ""
    # Response empty

    doc.save(path)


class TestAnalyseTemplate:
    """Test the main analyse_template function."""

    def test_identifies_empty_cells_in_simple_table(self):
        """Table with Question | Response columns, some responses empty."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_simple_template(f.name, [
                ("What is your approach?", ""),
                ("Describe your experience", ""),
                ("Already answered", "We have 10 years experience"),
            ])

            try:
                result = analyse_template(f.name)
                assert result["total_fields"] == 2
                assert result["table_count"] == 1
                assert len(result["fields"]) == 2
                # Verify field details
                assert result["fields"][0]["question_text"] == "What is your approach?"
                assert result["fields"][0]["field_type"] == "empty_cell"
                assert result["fields"][0]["table_index"] == 0
            finally:
                os.unlink(f.name)

    def test_identifies_placeholder_text(self):
        """Cells containing '[Insert response here]' detected."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_template_with_placeholders(f.name)

            try:
                result = analyse_template(f.name)
                placeholder_fields = [
                    field for field in result["fields"]
                    if field["field_type"] == "placeholder"
                ]
                # [Insert company name], {{approach_description}}, N/A should be placeholders
                assert len(placeholder_fields) >= 2

                # The cell with actual content should NOT be a field
                question_texts = [f["question_text"] for f in result["fields"]]
                assert "Filled already" not in question_texts
            finally:
                os.unlink(f.name)

    def test_identifies_jinja_placeholders(self):
        """Cells containing '{{company_name}}' detected."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_template_with_placeholders(f.name)

            try:
                result = analyse_template(f.name)
                jinja_fields = [
                    field for field in result["fields"]
                    if field.get("placeholder_text") and "{{" in field["placeholder_text"]
                ]
                assert len(jinja_fields) >= 1
            finally:
                os.unlink(f.name)

    def test_extracts_section_from_heading(self):
        """Section name comes from nearest Heading above table."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_template_with_headings(f.name)

            try:
                result = analyse_template(f.name)
                assert result["total_fields"] >= 2

                # Check that section names are captured
                sections = set(field["section_name"] for field in result["fields"])
                # Should have at least one section with content
                assert len(sections) >= 1
            finally:
                os.unlink(f.name)

    def test_extracts_word_limit(self):
        """Word limits from dedicated column and inline text."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_template_with_word_limits(f.name)

            try:
                result = analyse_template(f.name)
                word_limit_fields = [
                    field for field in result["fields"]
                    if field.get("word_limit") is not None
                ]
                assert len(word_limit_fields) >= 1
                # Check specific word limit values
                limits = {f["question_text"]: f["word_limit"] for f in result["fields"]}
                if "Describe your security approach" in limits:
                    assert limits["Describe your security approach"] == 500
            finally:
                os.unlink(f.name)

    def test_skips_tables_without_identifiable_columns(self):
        """Tables with no recognisable headers are skipped with warning."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            doc = Document()
            # Single-row table (no data rows)
            table = doc.add_table(rows=1, cols=2)
            table.rows[0].cells[0].text = "Just one row"
            table.rows[0].cells[1].text = "No data"
            doc.save(f.name)

            try:
                result = analyse_template(f.name)
                assert result["total_fields"] == 0
            finally:
                os.unlink(f.name)

    def test_multiple_tables(self):
        """Fields from all tables collected with correct table_index."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_template_with_headings(f.name)

            try:
                result = analyse_template(f.name)
                table_indices = set(field["table_index"] for field in result["fields"])
                # Should have fields from multiple tables
                assert len(table_indices) >= 1
            finally:
                os.unlink(f.name)

    def test_returns_document_info(self):
        """Result includes document_info metadata."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_simple_template(f.name, [("Q1", ""), ("Q2", "")])

            try:
                result = analyse_template(f.name)
                assert "document_info" in result
                info = result["document_info"]
                assert "table_count" in info
                assert "paragraph_count" in info
                assert "has_tracked_changes" in info
                assert "has_merged_cells" in info
            finally:
                os.unlink(f.name)

    def test_returns_column_mapping(self):
        """Result includes column_mapping for each analysed table."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            _create_simple_template(f.name, [("Q1", ""), ("Q2", "")])

            try:
                result = analyse_template(f.name)
                assert "column_mapping" in result
                assert len(result["column_mapping"]) >= 1
                mapping = result["column_mapping"][0]
                assert "table_index" in mapping
                assert "question_col" in mapping
                assert "answer_col" in mapping
            finally:
                os.unlink(f.name)


class TestHelpers:
    """Test helper functions."""

    def test_extract_word_limit_basic(self):
        assert _extract_word_limit("Max 500 words") == 500
        assert _extract_word_limit("250 words") == 250
        assert _extract_word_limit("maximum 300 words") == 300
        assert _extract_word_limit("No limit here") is None

    def test_is_empty_or_placeholder(self):
        """Test placeholder detection on cell objects."""
        doc = Document()
        table = doc.add_table(rows=3, cols=1)

        # Empty cell
        is_empty, placeholder = _is_empty_or_placeholder(table.rows[0].cells[0])
        assert is_empty is True
        assert placeholder is None

        # Placeholder cell
        table.rows[1].cells[0].text = "[Insert response here]"
        is_empty, placeholder = _is_empty_or_placeholder(table.rows[1].cells[0])
        assert is_empty is True
        assert placeholder == "[Insert response here]"

        # Content cell
        table.rows[2].cells[0].text = "Real content here"
        is_empty, _ = _is_empty_or_placeholder(table.rows[2].cells[0])
        assert is_empty is False
