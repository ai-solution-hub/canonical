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


def test_quality_warnings_contain_expected(case):
    spec, result = case
    for warning in spec["quality_warnings"]:
        assert warning in result.quality_warnings


def test_content_plain_has_no_markdown_syntax(case):
    _spec, result = case
    assert "#" not in result.content_plain
    assert "|" not in result.content_plain
    assert "```" not in result.content_plain
    # None of the fixtures use '*' for emphasis, so any surviving '*' would
    # indicate a stripping regression.
    assert "*" not in result.content_plain
