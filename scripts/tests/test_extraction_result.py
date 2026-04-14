"""Tests for kb_pipeline.extraction_result — Python dataclass + factory.

Mirrors __tests__/lib/extraction-result.test.ts case-for-case. Any rule change
requires updating both files in lockstep. Cross-language equivalence is
asserted in test_extraction_result_parity.py.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.extraction_result import (  # noqa: E402
    EXTRACTOR_VERSION,
    _strip_markdown,
    create_pipeline_extraction_result,
)


def _make(**overrides):
    defaults = dict(
        source_format="html",
        title="Test",
        content_markdown="",
        extraction_method="test",
        extraction_confidence="high",
    )
    defaults.update(overrides)
    return create_pipeline_extraction_result(**defaults)


class TestContentPlain:
    def test_strips_headings_and_bold(self):
        result = _make(content_markdown="## Heading\n\nSome **bold** text.")
        assert result.content_plain == "Heading\n\nSome bold text."

    def test_empty_input(self):
        assert _strip_markdown("") == ""


class TestHeadings:
    def test_extracts_all_levels(self):
        result = _make(content_markdown="# H1\n\n## H2\n\n### H3")
        assert len(result.headings) == 3
        assert result.headings[0]["level"] == 1
        assert result.headings[0]["text"] == "H1"
        assert result.headings[1]["level"] == 2
        assert result.headings[2]["level"] == 3

    def test_heading_position_is_char_offset(self):
        result = _make(content_markdown="# H1\n\n## H2")
        assert result.headings[0]["position"] == 0
        assert result.headings[1]["position"] == 6


class TestWordCount:
    def test_counts_plain_words(self):
        result = _make(content_markdown="One two three four five")
        assert result.word_count == 5


class TestDetection:
    def test_detects_tables(self):
        result = _make(content_markdown="| A | B |\n| --- | --- |\n| 1 | 2 |")
        assert result.has_tables is True

    def test_detects_code_blocks(self):
        result = _make(content_markdown="```\nconst x = 1;\n```")
        assert result.has_code_blocks is True

    def test_no_tables_when_plain(self):
        result = _make(content_markdown="Just prose.")
        assert result.has_tables is False


class TestQualityWarnings:
    def test_very_short_content(self):
        result = _make(content_markdown="Short piece.")
        assert "very short content" in result.quality_warnings

    def test_not_short_when_50_or_more(self):
        body = " ".join(f"word{i}" for i in range(60))
        result = _make(content_markdown=body)
        assert "very short content" not in result.quality_warnings

    def test_no_headings_only_when_over_200_words(self):
        long_body = " ".join(f"word{i}" for i in range(220))
        result_long = _make(content_markdown=long_body)
        assert "no headings detected" in result_long.quality_warnings

        result_short = _make(content_markdown="Just plain text without any headings.")
        assert "no headings detected" not in result_short.quality_warnings

    def test_pdf_with_no_tables(self):
        body = " ".join(f"word{i}" for i in range(80))
        result = _make(
            source_format="pdf",
            content_markdown=f"# Heading\n\n{body}",
        )
        assert "no tables detected in PDF" in result.quality_warnings

    def test_pdf_with_tables_no_warning(self):
        result = _make(
            source_format="pdf",
            content_markdown="# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
        )
        assert "no tables detected in PDF" not in result.quality_warnings

    def test_high_ratio(self):
        result = _make(
            content_markdown=(
                "[link text](https://example.com) "
                "[link text](https://example.com) "
                "[link text](https://example.com)"
            )
        )
        assert "high markdown-to-plain ratio" in result.quality_warnings

    def test_low_ratio_no_warning(self):
        result = _make(content_markdown="Plain prose with no decoration at all.")
        assert "high markdown-to-plain ratio" not in result.quality_warnings

    def test_empty_title(self):
        result = _make(title="", content_markdown="Content here.")
        assert "empty title" in result.quality_warnings


class TestProvenance:
    def test_version_and_timestamp(self):
        result = _make(content_markdown="Content.")
        assert result.extractor_version == EXTRACTOR_VERSION
        assert re.match(r"^\d{4}-\d{2}-\d{2}T", result.extracted_at)

    def test_passes_through_source_url(self):
        result = _make(
            content_markdown="Content.",
            source_url="https://example.com",
        )
        assert result.source_url == "https://example.com"


class TestEmptyContent:
    def test_empty_markdown_does_not_throw(self):
        result = _make(content_markdown="")
        assert result.content_plain == ""
        assert result.word_count == 0
        assert result.headings == []
        assert result.has_tables is False
        assert result.has_code_blocks is False
        assert "very short content" in result.quality_warnings
        assert "high markdown-to-plain ratio" not in result.quality_warnings
