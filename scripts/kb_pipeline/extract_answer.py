"""
Extract the answer portion from a composite Q&A content string.

Mirrors the TS helper at lib/bid-library-ingest/extract-answer.ts exactly.

Composite content arrives shaped as "Q: {question}\\n\\n{answer}". This helper
returns only the answer portion, stripping the question prefix. If the content
is not in composite form (no "Q: " prefix), it is returned unchanged.

Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss4.6.
"""


def extract_answer_from_content(content: str | None) -> str:
    """Extract the answer portion from a composite Q&A content string.

    Args:
        content: The content string, potentially shaped as "Q: {q}\\n\\n{answer}".

    Returns:
        The answer portion if composite, or the original content if not.
        Empty string for None/empty input.
    """
    if not content:
        return ""
    if content.startswith("Q: "):
        separator_index = content.find("\n\n")
        if separator_index != -1:
            return content[separator_index + 2 :]
    return content
