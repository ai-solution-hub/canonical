"""Tests for chunk.py — heading-based markdown chunking."""

import os
import sys

# Add scripts dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from kb_pipeline.chunk import (
    chunk_by_headings,
    MIN_DOCUMENT_CHARS,
    MIN_CHUNK_CHARS,
)


# ──────────────────────────────────────────
# chunk_by_headings
# ──────────────────────────────────────────


class TestChunkByHeadings:
    """Tests for the heading-based markdown splitter."""

    def test_empty_string_returns_empty_list(self):
        assert chunk_by_headings("") == []
        assert chunk_by_headings("   \n\n  ") == []

    def test_short_document_single_chunk(self):
        """Documents under MIN_DOCUMENT_CHARS become a single heading-less chunk."""
        short = "# Title\n\nJust a short paragraph, well below the threshold."
        assert len(short) < MIN_DOCUMENT_CHARS
        chunks = chunk_by_headings(short)
        assert len(chunks) == 1
        assert chunks[0].heading_text is None
        assert chunks[0].heading_level is None
        assert chunks[0].heading_path == []
        assert chunks[0].position == 0
        assert chunks[0].content.startswith("# Title")

    def test_h2_split_produces_one_chunk_per_section(self):
        """A long document with H2 boundaries splits at each H2, plus preamble."""
        # Preamble + 2 H2 sections => 3 chunks. Each section must clear
        # MIN_CHUNK_CHARS (100) and the total must clear MIN_DOCUMENT_CHARS (500).
        preamble = "Preamble content. " * 15  # > 100 chars
        section_a = "Alpha content. " * 20
        section_b = "Bravo content. " * 20
        markdown = (
            f"{preamble}\n\n"
            f"## Section A\n\n{section_a}\n\n"
            f"## Section B\n\n{section_b}"
        )
        assert len(markdown) >= MIN_DOCUMENT_CHARS

        chunks = chunk_by_headings(markdown)
        assert len(chunks) == 3

        # Preamble chunk has no heading
        assert chunks[0].heading_text is None
        assert chunks[0].heading_level is None
        assert chunks[0].heading_path == []

        # Section A
        assert chunks[1].heading_text == "Section A"
        assert chunks[1].heading_level == 2
        assert chunks[1].heading_path == ["Section A"]
        assert chunks[1].content.startswith("## Section A")
        assert "Alpha content" in chunks[1].content

        # Section B
        assert chunks[2].heading_text == "Section B"
        assert chunks[2].heading_level == 2
        assert chunks[2].content.startswith("## Section B")
        assert "Bravo content" in chunks[2].content

        # Positions are contiguous 0-based ordinals
        assert [c.position for c in chunks] == [0, 1, 2]

    def test_code_block_headings_are_ignored(self):
        """Heading-like lines inside fenced code blocks MUST NOT trigger splits."""
        # Use a preamble so the first H2 chunk isn't merged by the
        # small-chunk-merge pass. Each section clears MIN_CHUNK_CHARS (100).
        padding = "Real content line. " * 15  # ~285 chars
        markdown = (
            f"{padding}\n\n"
            "## Real Heading\n\n"
            f"{padding}\n\n"
            "```python\n"
            "# Not a heading\n"
            "## Also not a heading\n"
            "def foo():\n"
            "    pass\n"
            "```\n\n"
            f"{padding}\n\n"
            "## Another Real Heading\n\n"
            f"{padding}\n"
        )
        assert len(markdown) >= MIN_DOCUMENT_CHARS

        chunks = chunk_by_headings(markdown)
        headings = [c.heading_text for c in chunks if c.heading_text]

        # Only real H2 headings should appear as chunk heading_text
        assert "Not a heading" not in headings
        assert "Also not a heading" not in headings
        assert "Real Heading" in headings
        assert "Another Real Heading" in headings

        # At least one chunk should contain the code fence literally
        assert any("```python" in c.content for c in chunks)
        # The fake headings must live inside a chunk's content, not become a header
        assert any("# Not a heading" in c.content for c in chunks)
