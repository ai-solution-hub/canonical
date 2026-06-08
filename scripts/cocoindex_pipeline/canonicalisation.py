"""Per-document deterministic canonicalisation for entity names.

PRODUCT.md Inv-4: the per-item phase writes a deterministic per-doc
canonical_name via this function BEFORE Stage-5 runs. The Stage-5
post-pass (§P-6) UPDATEs the value when cross-document resolution
maps to a different canonical; Stage-5 NEVER inserts rows.

Algorithm mirrors the legacy canonicalise() semantics so
pipeline-produced canonicals match the established canonicalisation contract.
"""

from __future__ import annotations

import re
import unicodedata

_ISO_SLASH_RE = re.compile(r"\biso\s*/\s*iec\s+", re.IGNORECASE)
_ISO_TIGHT_RE = re.compile(r"\biso\s*(\d{4,5})\b", re.IGNORECASE)
_ISO_VERSION_RE = re.compile(r":(\d{4})\b")


def canonicalise_entity_name(name: str, entity_type: str) -> str:
    """Return the per-document canonical for an entity name.

    Args:
        name: The raw entity name extracted by the LLM.
        entity_type: One of the 12 canonical entity_type values
            (database.types.ts:1141 enum).

    Returns:
        The lowercase + ASCII-folded + entity_type-aware-normalised
        canonical_name. Deterministic + idempotent.
    """
    if not name:
        return ""
    # Step 1: trim
    result = name.strip()
    # Step 2: ASCII-fold then lowercase
    result = unicodedata.normalize("NFKD", result)
    result = "".join(c for c in result if not unicodedata.combining(c))
    result = result.lower()
    # Step 3: entity_type-aware normalisation
    if entity_type == "certification":
        result = _ISO_SLASH_RE.sub("iso ", result)
        result = _ISO_TIGHT_RE.sub(lambda m: f"iso {m.group(1)}", result)
        result = _ISO_VERSION_RE.sub("", result)
    # Steps for technology/product trailing-suffix strip omitted for brevity
    # — TECH commits the v1 surface; richer rules surfaced in {53.4} PLAN.
    return result.strip()
