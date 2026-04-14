"""Cross-language parity fixtures for PipelineExtractionResult (Python side).

Mirrors __tests__/lib/extraction-result-parity.test.ts byte-for-byte. The same
five markdown fixtures appear in both files, with the same expected values for
each derived field. Any fixture or assertion change must land in both files in
the same commit.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.extraction_result import (  # noqa: E402
    create_pipeline_extraction_result,
)


SIMPLE_ARTICLE = """# Main Title

## Background

This article discusses an important topic in depth. It provides context and examples. The first paragraph introduces the reader to the core ideas, sets expectations, and explains why the topic matters right now for the audience.

## Conclusion

The key takeaway is that quality matters more than speed. We should always prioritise careful thinking and thorough review over rushing to a conclusion. Readers who follow the guidance in this article will find their decisions better grounded in evidence."""

TABLE_HEAVY_POLICY = """# Procurement Policy

## Thresholds

| Category | Min Value | Max Value | Approver | Review Period |
| --- | --- | --- | --- | --- |
| Goods | 0 | 10000 | Manager | Annual |
| Services | 0 | 25000 | Director | Biennial |
| Works | 0 | 100000 | Board | Annual |

All procurements must follow the thresholds above. Exceptions require written sign-off from the approver named for the relevant category. This policy applies across every department without exception and is reviewed on the cadence shown in the final column. All staff involved in purchasing decisions should familiarise themselves with the thresholds and escalation paths before raising any purchase order."""

CODE_DOCUMENTATION = """# API Examples

## Python

```python
def greet(name):
    return f"Hello, {name}"
```

## TypeScript

```typescript
function greet(name: string): string {
  return `Hello, ${name}`;
}
```

Both snippets demonstrate the same pattern across two languages for comparison."""

MINIMAL_CONTENT = "Just a brief note with only a handful of words here."

EMPTY_CONTENT = ""

LONG_NO_HEADINGS = """The implementation of a comprehensive knowledge base platform requires careful attention to multiple interconnected concerns. First, the data model must accommodate the variety of content types that organisations produce, from short policy statements through to lengthy technical documentation. Second, the extraction pipeline needs to handle diverse source formats without losing structural information during conversion. Third, the classification layer must correctly identify domains, subtopics, entities, and relationships at scale. Fourth, the retrieval experience must be fast enough to feel responsive while still producing high-quality results for both semantic and keyword queries.

Beyond these core concerns, there are many secondary considerations. Access control must respect organisational boundaries. Content freshness must be tracked so stale information can be surfaced for review. Provenance must be preserved so every claim can be traced back to a source document. The user interface must be approachable for non-technical users while still providing power features for administrators. All of this must work reliably in production, with appropriate observability and error handling.

Building a system that meets all of these requirements is not simple. It takes careful sequencing of work, clear architectural decisions, and ongoing refinement based on real usage. The team must resist the urge to build everything at once and instead deliver incremental value while laying the foundations that will support future growth. Only then can the platform reach its full potential as a genuine knowledge asset rather than just another content silo."""

PDF_NO_TABLES = """# Annual Report Summary

## Key Findings

The organisation achieved its primary objectives during the reporting period. Growth in core service lines exceeded expectations. Operational costs remained within budgeted levels. Staff engagement scores improved year-on-year. Customer satisfaction metrics held steady despite broader market pressures. Strategic investment in platform capabilities is beginning to yield measurable returns. The board remains confident in the direction and long-term outlook."""

LINK_HEAVY = """# Reference Links

Readers who want more detail should consult the primary documentation. See the manual at [the reference manual guide](https://example.com/documentation/reference-manual/chapter-one/part-two/section-three/subsection-four) and the companion [complete API overview documentation](https://example.com/documentation/api-overview/introduction/primer/advanced/details). Additional context is in [the architecture design brief](https://example.com/documentation/architecture/design-brief/summary/version-three-point-zero), [the integration setup guide](https://example.com/documentation/integrations/setup-guide/primer/examples/patterns), [the troubleshooting reference](https://example.com/documentation/troubleshoot/common-issues/reference-guide/patterns/solutions), and [the release notes for the current quarter](https://example.com/documentation/release/notes/latest/current/changes). These resources together cover most use cases."""


CASES = [
    {
        "name": "SIMPLE_ARTICLE",
        "markdown": SIMPLE_ARTICLE,
        "source_format": "html",
        "word_count": 80,
        "headings": [
            {"level": 1, "text": "Main Title"},
            {"level": 2, "text": "Background"},
            {"level": 2, "text": "Conclusion"},
        ],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": [],
    },
    {
        "name": "TABLE_HEAVY_POLICY",
        "markdown": TABLE_HEAVY_POLICY,
        "source_format": "pdf",
        "word_count": 84,
        "headings": [
            {"level": 1, "text": "Procurement Policy"},
            {"level": 2, "text": "Thresholds"},
        ],
        "has_tables": True,
        "has_code_blocks": False,
        "quality_warnings": [],
    },
    {
        "name": "CODE_DOCUMENTATION",
        "markdown": CODE_DOCUMENTATION,
        "source_format": "html",
        "word_count": 33,
        "headings": [
            {"level": 1, "text": "API Examples"},
            {"level": 2, "text": "Python"},
            {"level": 2, "text": "TypeScript"},
        ],
        "has_tables": False,
        "has_code_blocks": True,
        "quality_warnings": ["very short content"],
    },
    {
        "name": "MINIMAL_CONTENT",
        "markdown": MINIMAL_CONTENT,
        "source_format": "html",
        "word_count": 11,
        "headings": [],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": ["very short content"],
    },
    {
        "name": "EMPTY_CONTENT",
        "markdown": EMPTY_CONTENT,
        "source_format": "html",
        "word_count": 0,
        "headings": [],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": ["very short content"],
    },
    {
        "name": "LONG_NO_HEADINGS",
        "markdown": LONG_NO_HEADINGS,
        "source_format": "html",
        "word_count": 236,
        "headings": [],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": ["no headings detected"],
    },
    {
        "name": "PDF_NO_TABLES",
        "markdown": PDF_NO_TABLES,
        "source_format": "pdf",
        "word_count": 62,
        "headings": [
            {"level": 1, "text": "Annual Report Summary"},
            {"level": 2, "text": "Key Findings"},
        ],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": ["no tables detected in PDF"],
    },
    {
        "name": "LINK_HEAVY",
        "markdown": LINK_HEAVY,
        "source_format": "html",
        "word_count": 57,
        "headings": [{"level": 1, "text": "Reference Links"}],
        "has_tables": False,
        "has_code_blocks": False,
        "quality_warnings": ["high markdown-to-plain ratio"],
    },
]


@pytest.fixture(params=CASES, ids=lambda c: c["name"])
def case(request):
    spec = request.param
    result = create_pipeline_extraction_result(
        source_format=spec["source_format"],
        title="T",
        content_markdown=spec["markdown"],
        extraction_method="parity-fixture",
        extraction_confidence="high",
    )
    return spec, result


def test_word_count_matches_within_one(case):
    spec, result = case
    assert abs(result.word_count - spec["word_count"]) <= 1


def test_headings_length_matches(case):
    spec, result = case
    assert len(result.headings) == len(spec["headings"])


def test_heading_levels_match(case):
    spec, result = case
    assert [h["level"] for h in result.headings] == [h["level"] for h in spec["headings"]]


def test_heading_text_matches(case):
    spec, result = case
    assert [h["text"] for h in result.headings] == [h["text"] for h in spec["headings"]]


def test_has_tables_matches(case):
    spec, result = case
    assert result.has_tables is spec["has_tables"]


def test_has_code_blocks_matches(case):
    spec, result = case
    assert result.has_code_blocks is spec["has_code_blocks"]


def test_quality_warnings_set_matches_exactly(case):
    spec, result = case
    assert set(result.quality_warnings) == set(spec["quality_warnings"])


def test_content_plain_has_no_markdown_syntax(case):
    _spec, result = case
    assert "#" not in result.content_plain
    assert "|" not in result.content_plain
    assert "```" not in result.content_plain
    # None of the fixtures use '*' for emphasis, so any surviving '*' would
    # indicate a stripping regression.
    assert "*" not in result.content_plain
