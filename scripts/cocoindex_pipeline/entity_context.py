"""Per-mention context snippet extraction.

Python port of lib/entities/entity-context.ts:19 extractEntityContext.
PRODUCT.md Inv-17: every Stage-5-produced entity_mentions row carries
a non-NULL context_snippet — the per-item phase calls this function
inside ingest_file (§P-3) before the declare_row site.
"""

from __future__ import annotations

CONTEXT_RADIUS = 80


def extract_entity_context(text: str, entity_name: str) -> str:
    """Return a context snippet showing where entity_name appears in text.

    Mirrors lib/entities/entity-context.ts:19. Case-insensitive search;
    returns the first occurrence with +/-80 chars of surrounding context.
    Adds "..." ellipsis markers where the snippet was truncated.

    Args:
        text:        Full plain text to search in.
        entity_name: Entity name to locate (case-insensitive).

    Returns:
        Context snippet string; empty string if entity not found.
    """
    if not text or not entity_name:
        return ""
    lower_text = text.lower()
    lower_entity = entity_name.lower()
    idx = lower_text.find(lower_entity)
    if idx == -1:
        return ""
    return _window(text, idx, idx + len(entity_name))


def _window(text: str, start: int, end: int) -> str:
    """The +/-CONTEXT_RADIUS window around [start, end), with ellipsis markers."""
    lo = max(0, start - CONTEXT_RADIUS)
    hi = min(len(text), end + CONTEXT_RADIUS)
    snippet = text[lo:hi].strip()
    if lo > 0:
        snippet = f"...{snippet}"
    if hi < len(text):
        snippet = f"{snippet}..."
    return snippet


def span_brackets_entity(
    text: str, entity_name: str, span_start: int | None, span_end: int | None
) -> bool:
    """Whether the extractor's span is in-bounds AND actually holds entity_name.

    The extraction prompt states the contract twice (``prompts.py:171``, ``:196``):
    ``content_text[source_span_start:source_span_end]`` MUST equal entity_name.
    NOTHING enforces it — ``extraction.py`` validates only ``Field(ge=0)``: no
    upper bound, no ``end > start``, no slice check. So the span is a claim, and
    this is the check that makes it evidence.

    Both halves are load-bearing, and the second is why bounds alone will not do.
    ``mock_llm.py:191-192`` emits ``source_span_start=0,
    source_span_end=len(tag_name)`` for its per-content tag row — a perfectly
    in-bounds span that points at the document's opening characters and has
    nothing to do with the entity. Trusting it yields a snippet like
    ``'# Team Structure and '`` for an entity named ``MOCK Org 0aaac9d6d05f``:
    non-empty, and a confident lie about where the entity appears.
    """
    if span_start is None or span_end is None:
        return False
    if span_start < 0 or span_end <= span_start or span_end > len(text):
        return False
    return text[span_start:span_end].strip().lower() == entity_name.strip().lower()


def entity_context_for_mention(
    text: str,
    entity_name: str,
    span_start: int | None = None,
    span_end: int | None = None,
) -> str:
    """Context snippet for one mention: span-derived when the span is honest.

    Resolution order, and the empty string is a RESULT, not a failure:

    1. **The extractor's span**, when :func:`span_brackets_entity` accepts it.
       Strictly better than searching: it resolves the occurrence the extractor
       actually meant rather than the first textual match, and it is O(1) rather
       than a scan. For a document naming the same entity five times, the
       search-based snippet describes the wrong sentence four times out of five.
    2. **A case-insensitive search** for ``entity_name`` — the prior behaviour,
       and the right answer whenever an extractor supplies no usable span.
    3. **``''``** when the surface form does not occur in ``text`` at all.

    Case 3 is truthful and must stay reachable. An extractor may normalise a
    name ("Acme Ltd" for "Acme Limited"), or synthesise one, in which case the
    entity genuinely does not appear in the converted text. The live requirement
    for this column is ``producer/enrich.py:407`` — a snippet is the evidence
    that the parent document was *genuinely read*, which is what makes that
    document citable in the bundle. Substituting unrelated text to avoid an
    empty string does not satisfy that requirement; it corrupts it.
    """
    if span_brackets_entity(text, entity_name, span_start, span_end):
        # mypy/type narrowing: the guard proved both are non-None ints.
        return _window(text, int(span_start or 0), int(span_end or 0))
    return extract_entity_context(text, entity_name)
