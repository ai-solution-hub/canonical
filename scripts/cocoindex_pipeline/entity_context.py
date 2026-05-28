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
    start = max(0, idx - CONTEXT_RADIUS)
    end = min(len(text), idx + len(entity_name) + CONTEXT_RADIUS)
    snippet = text[start:end].strip()
    if start > 0:
        snippet = f"...{snippet}"
    if end < len(text):
        snippet = f"{snippet}..."
    return snippet
