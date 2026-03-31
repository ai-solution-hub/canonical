"""Temporal-to-entity bridge — connects temporal references to entity mentions.

After classification stores both entity_mentions and temporal references
(in content_items.metadata.ai_temporal_references), this bridge function
matches expiry/effective dates to the relevant certification/framework/regulation
entities and writes the dates into entity_mentions.metadata.

Uses token-level matching (not substring) for robust partial name matching.
"""

import logging
import re
import urllib.parse
from typing import List, Optional

from .store import _request

logger = logging.getLogger(__name__)

# Entity types that can receive temporal metadata
TEMPORAL_ENTITY_TYPES = frozenset(["certification", "framework", "regulation"])

# Regex for splitting on whitespace and punctuation
_TOKEN_SPLIT_RE = re.compile(r"[\s/\-_:;,.()]+")


def _tokenise(text: str) -> List[str]:
    """Split text into lowercase tokens on whitespace and punctuation."""
    if not text:
        return []
    return [t for t in _TOKEN_SPLIT_RE.split(text.lower()) if t]


def _token_match(context: str, canonical_name: str) -> bool:
    """Check if context string matches the canonical entity name via token overlap.

    Thresholds:
      - coverage >= 1.0 (all name tokens present) -> match
      - coverage >= 0.7 -> match
      - coverage >= 0.5 AND len(name_tokens) <= 2 -> match
      - coverage < 0.5 -> no match
    """
    name_tokens = _tokenise(canonical_name)
    if not name_tokens:
        return False

    context_tokens = set(_tokenise(context))
    if not context_tokens:
        return False

    overlap = sum(1 for t in name_tokens if t in context_tokens)
    coverage = overlap / len(name_tokens)

    if coverage >= 0.7:
        return True
    if coverage >= 0.5 and len(name_tokens) <= 2:
        return True
    return False


def bridge_temporal_to_entities(item_id: str) -> int:
    """Bridge temporal references to entity mentions for a content item.

    Reads ai_temporal_references from content_items.metadata, fetches
    entity_mentions (certification/framework/regulation only), and
    matches temporal references to entities using token-level matching
    on the context string.

    Returns the number of entity mentions updated.
    """
    # 1. Read content item metadata for temporal references
    path = (
        f"content_items?id=eq.{urllib.parse.quote(item_id, safe='')}"
        f"&select=metadata"
    )
    status, data = _request("GET", path)

    if status not in (200, 206) or not data:
        logger.debug("Bridge: could not read content item %s (status %s)", item_id, status)
        return 0

    item = data[0] if isinstance(data, list) else data
    metadata = item.get("metadata") or {}
    ai_refs = metadata.get("ai_temporal_references")

    if not ai_refs or not isinstance(ai_refs, list):
        return 0

    # 2. Read entity mentions for this content item (temporal entity types only)
    types_filter = ",".join(f'"{t}"' for t in sorted(TEMPORAL_ENTITY_TYPES))
    mentions_path = (
        f"entity_mentions?content_item_id=eq.{urllib.parse.quote(item_id, safe='')}"
        f"&entity_type=in.({urllib.parse.quote(types_filter, safe='')})"
        f"&select=id,canonical_name,entity_type,metadata"
    )
    status, mentions = _request("GET", mentions_path)

    if status not in (200, 206) or not mentions:
        return 0

    # 3. Match temporal references to entity mentions by token overlap
    updated_count = 0

    for mention in mentions:
        canonical_name = mention.get("canonical_name", "")
        existing_metadata = mention.get("metadata") or {}
        new_metadata = dict(existing_metadata)
        changed = False

        for ref in ai_refs:
            context = ref.get("context", "")
            context_type = ref.get("context_type", "")
            date_value = ref.get("date", "")

            if not context or not date_value:
                continue

            if not _token_match(context, canonical_name):
                continue

            if context_type == "expiry":
                new_metadata["expiry_date"] = date_value
                changed = True
            elif context_type == "effective":
                new_metadata["date_obtained"] = date_value
                changed = True

        # 4. Update entity mention metadata if we found matching references
        if changed:
            update_path = f"entity_mentions?id=eq.{urllib.parse.quote(mention['id'], safe='')}"
            update_status, _ = _request(
                "PATCH", update_path, {"metadata": new_metadata},
                prefer="return=minimal",
            )
            if update_status in (200, 204):
                updated_count += 1
            else:
                logger.warning(
                    "Bridge: failed to update entity mention %s (status %s)",
                    mention["id"], update_status,
                )

    return updated_count
