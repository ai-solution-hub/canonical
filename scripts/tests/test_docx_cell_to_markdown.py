"""Tests for docx_cell_to_markdown.py — HTML-to-markdown cell conversion.

Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.3, ss10.1.
"""

import sys
import os
import re
from urllib.parse import urlparse

# Add scripts dir to path so we can import the module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from docx_cell_to_markdown import (
    html_cell_to_markdown,
    plain_text_to_markdown,
    _strip_html_tags,
)


# ── html_cell_to_markdown ────────────────────────────────────────────────


class TestHtmlCellToMarkdown:
    """Tests for HTML-to-markdown conversion via pandoc."""

    def test_converts_bold(self):
        """Bold HTML becomes **bold** markdown."""
        result = html_cell_to_markdown("<p><strong>Important</strong> text</p>")
        assert "**Important**" in result
        assert "text" in result

    def test_converts_italic(self):
        """Italic HTML becomes *italic* markdown."""
        result = html_cell_to_markdown("<p><em>Emphasised</em> text</p>")
        assert "*Emphasised*" in result
        assert "text" in result

    def test_converts_unordered_list(self):
        """Unordered HTML list becomes markdown list."""
        result = html_cell_to_markdown(
            "<ul><li>Item one</li><li>Item two</li></ul>"
        )
        assert "Item one" in result
        assert "Item two" in result
        # Should contain list markers (- or *)
        assert "-" in result or "*" in result

    def test_converts_ordered_list(self):
        """Ordered HTML list becomes numbered markdown list."""
        result = html_cell_to_markdown(
            "<ol><li>First</li><li>Second</li></ol>"
        )
        assert "First" in result
        assert "Second" in result
        assert "1." in result

    def test_converts_link(self):
        """HTML link becomes markdown link."""
        result = html_cell_to_markdown(
            '<p><a href="https://example.com">Link text</a></p>'
        )
        assert "[Link text]" in result
        match = re.search(r"\[[^\]]+\]\(([^)]+)\)", result)
        assert match is not None
        parsed = urlparse(match.group(1))
        assert parsed.scheme == "https"
        assert parsed.hostname == "example.com"

    def test_handles_empty_input(self):
        """Empty input returns empty string."""
        assert html_cell_to_markdown("") == ""
        assert html_cell_to_markdown("   ") == ""

    def test_handles_plain_text(self):
        """Plain text (no HTML tags) passes through."""
        result = html_cell_to_markdown("Just plain text")
        assert "Just plain text" in result

    def test_converts_table(self):
        """HTML table becomes markdown table."""
        result = html_cell_to_markdown(
            "<table><tr><th>Header</th></tr><tr><td>Cell</td></tr></table>"
        )
        assert "Header" in result
        assert "Cell" in result
        assert "|" in result


# ── plain_text_to_markdown ───────────────────────────────────────────────


class TestPlainTextToMarkdown:
    """Tests for plain text pass-through."""

    def test_preserves_text(self):
        """Plain text is preserved."""
        assert plain_text_to_markdown("Hello world") == "Hello world"

    def test_strips_whitespace(self):
        """Leading/trailing whitespace is stripped."""
        assert plain_text_to_markdown("  Hello  ") == "Hello"

    def test_collapses_blank_lines(self):
        """Multiple blank lines collapse to a single blank line."""
        result = plain_text_to_markdown("Para 1\n\n\n\nPara 2")
        assert result == "Para 1\n\nPara 2"

    def test_handles_empty_input(self):
        """Empty input returns empty string."""
        assert plain_text_to_markdown("") == ""
        assert plain_text_to_markdown(None) == ""


# ── _strip_html_tags ─────────────────────────────────────────────────────


class TestStripHtmlTags:
    """Tests for the HTML tag stripping fallback."""

    def test_strips_simple_tags(self):
        """Simple HTML tags are stripped."""
        assert _strip_html_tags("<p>Hello</p>") == "Hello"

    def test_strips_nested_tags(self):
        """Nested HTML tags are stripped."""
        assert _strip_html_tags("<p><strong>Bold</strong> text</p>") == "Bold text"

    def test_handles_empty_input(self):
        """Empty input returns empty string."""
        assert _strip_html_tags("") == ""
