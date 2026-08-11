"""Deterministic key derivation for entity names.

DR-140: this produces what a stable primary key needs and nothing more. It is
NOT the mechanism that decides two names are one thing — `resolve_entities` is.
"""

from __future__ import annotations

import unicodedata


def canonicalise_entity_name(name: str) -> str:
    """Return the deterministic key for an entity name.

    strip → NFKD → drop combining marks → lower. Deterministic + idempotent.
    """
    if not name:
        return ""
    result = unicodedata.normalize("NFKD", name.strip())
    result = "".join(c for c in result if not unicodedata.combining(c))
    return result.lower().strip()

