"""
Resolve the full question text for a Q&A content rebuild.

Python mirror of lib/bid-library-ingest/resolve-question.ts.
Produces byte-identical output for identical input.

Used by future re-parse flows for consistency with the TS PATCH handler.
The Python importer uses the full pair-level `question_text` at insert time
so this function is not on the primary import path today.

Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.2 Option B.
"""

from typing import Optional


def resolve_question_for_rebuild(
    current_content: Optional[str],
    current_title: Optional[str],
) -> str:
    """Extract the question text from current content or fall back to the title.

    Priority:
    1. If ``current_content`` starts with ``Q: ``, return the text after the
       prefix (first line only, untruncated).
    2. Otherwise return ``current_title`` (may be truncated at 120 chars by the
       importer's ``truncate_at_word_boundary``).
    3. If both are ``None``, return an empty string.
    """
    if current_content:
        first_line = current_content.split("\n", 1)[0]
        if first_line.startswith("Q: "):
            return first_line[3:]
    return current_title if current_title is not None else ""
