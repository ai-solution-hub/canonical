"""PipelineExtractionResult — Python mirror of lib/extraction/extraction-result.ts.

Both pipelines must produce equivalent output for the same source document.
Any logic change here requires the same change in the TypeScript counterpart
and vice versa. Parity is enforced by:

- scripts/tests/test_extraction_result_parity.py (Python side)
- __tests__/lib/extraction-result-parity.test.ts (TypeScript side)

Both parity suites use the same 5 markdown fixtures (as string constants) and
assert on the same derived fields. See docs/plans/plan-d-quality-documentation.md
Task D8 for fixture definitions.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


EXTRACTOR_VERSION = "1.0.0"


@dataclass
class Heading:
    level: int
    text: str
    position: int

    def to_dict(self) -> dict:
        return {"level": self.level, "text": self.text, "position": self.position}


@dataclass
class PipelineExtractionResult:
    """Intermediate extraction representation — quality gate between
    extraction and storage.

    Mirrors the TypeScript PipelineExtractionResult interface in
    lib/extraction/extraction-result.ts.
    """

    source_format: str = "html"
    title: str = ""
    content_markdown: str = ""
    content_plain: str = ""
    headings: list = field(default_factory=list)
    word_count: int = 0
    has_tables: bool = False
    has_code_blocks: bool = False
    extraction_method: str = ""
    extraction_confidence: str = "medium"
    quality_warnings: list = field(default_factory=list)
    extracted_at: str = ""
    extractor_version: str = EXTRACTOR_VERSION
    source_url: Optional[str] = None
    source_file: Optional[str] = None


# Ordered list of (pattern, replacement) pairs mirroring lib/content/strip-markdown.ts.
# Python's `re` has no literal equivalent of JS's per-line `^`/`$` in multiline mode
# without `re.MULTILINE`, so flags are set per-pattern below.
_STRIP_PATTERNS = [
    (re.compile(r"!\[([^\]]*)\]\([^)]+\)"), r"\1"),
    (re.compile(r"\[([^\]]+)\]\([^)]+\)"), r"\1"),
    (re.compile(r"^\[.+?\]:\s+.+$", re.MULTILINE), ""),
    (re.compile(r"^#{1,6}\s+", re.MULTILINE), ""),
    (re.compile(r"(\*\*|__)(.*?)\1"), r"\2"),
    (re.compile(r"(\*|_)(.*?)\1"), r"\2"),
    (re.compile(r"`([^`]+)`"), r"\1"),
    (re.compile(r"^```[\w]*$", re.MULTILINE), ""),
    (re.compile(r"^>\s+", re.MULTILINE), ""),
    (re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE), ""),
    (re.compile(r"^\|[-:\s|]+\|$", re.MULTILINE), ""),
]

_TABLE_ROW_RE = re.compile(r"^\|(.+)\|$", re.MULTILINE)
_TRIPLE_NEWLINE_RE = re.compile(r"\n{3,}")


def _strip_markdown(text: str) -> str:
    """Port of lib/content/strip-markdown.ts stripMarkdown().

    Pattern order is semantically significant — images must be stripped before
    links (to handle the leading '!'), and emphasis must be stripped after
    headings (so that '## **bold**' becomes 'bold' not '** **bold** **').

    The table-row replacement uses a callable because each match rewrites inner
    pipes to double-spaces after trimming, which cannot be expressed with a
    simple replacement string.
    """
    if not text:
        return ""

    out = text
    for pattern, replacement in _STRIP_PATTERNS:
        out = pattern.sub(replacement, out)

    def _table_row_sub(match: re.Match) -> str:
        inner = match.group(1)
        return inner.replace("|", "  ").strip()

    out = _TABLE_ROW_RE.sub(_table_row_sub, out)
    out = _TRIPLE_NEWLINE_RE.sub("\n\n", out)
    return out.strip()


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
_TABLE_DETECT_RE = re.compile(r"^\|.+\|$", re.MULTILINE)
_CODE_FENCE_RE = re.compile(r"^```", re.MULTILINE)


def _extract_headings(markdown: str) -> list:
    headings = []
    for match in _HEADING_RE.finditer(markdown):
        headings.append(
            Heading(
                level=len(match.group(1)),
                text=match.group(2).strip(),
                position=match.start(),
            ).to_dict()
        )
    return headings


def create_pipeline_extraction_result(
    *,
    source_format: str,
    title: str,
    content_markdown: str,
    extraction_method: str,
    extraction_confidence: str,
    source_url: Optional[str] = None,
    source_file: Optional[str] = None,
) -> PipelineExtractionResult:
    """Construct a PipelineExtractionResult from raw extraction output.

    Mirrors createPipelineExtractionResult() in lib/extraction/extraction-result.ts.
    Any rule change here must be mirrored in the TS factory and in both parity
    suites.
    """
    content_plain = _strip_markdown(content_markdown)
    word_count = len([w for w in content_plain.split() if w])
    headings = _extract_headings(content_markdown)
    has_tables = bool(_TABLE_DETECT_RE.search(content_markdown))
    has_code_blocks = bool(_CODE_FENCE_RE.search(content_markdown))

    warnings = []
    if word_count < 50:
        warnings.append("very short content")
    if len(headings) == 0 and word_count > 200:
        warnings.append("no headings detected")
    if source_format == "pdf" and not has_tables:
        warnings.append("no tables detected in PDF")
    if (
        len(content_plain) > 0
        and len(content_markdown) / len(content_plain) > 1.25
    ):
        warnings.append("high markdown-to-plain ratio")
    if not title.strip():
        warnings.append("empty title")

    return PipelineExtractionResult(
        source_format=source_format,
        title=title,
        content_markdown=content_markdown,
        content_plain=content_plain,
        headings=headings,
        word_count=word_count,
        has_tables=has_tables,
        has_code_blocks=has_code_blocks,
        extraction_method=extraction_method,
        extraction_confidence=extraction_confidence,
        quality_warnings=warnings,
        extracted_at=datetime.now(timezone.utc).isoformat(),
        extractor_version=EXTRACTOR_VERSION,
        source_url=source_url,
        source_file=source_file,
    )
