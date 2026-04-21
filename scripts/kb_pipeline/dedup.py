"""Deduplication — URL matching + embedding similarity + content-hash gate."""

import hashlib
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Optional, List, Tuple

from .store import check_url_exists
from .config import DEDUP_SIMILARITY_THRESHOLD, get_supabase_url, get_supabase_secret_key

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Content-hash dedup gate (S183 WP2)
# ---------------------------------------------------------------------------

# Mirror of `lib/dedup.ts::DEDUP_MIN_CONTENT_LENGTH`. Content shorter than
# this (post-normalisation) collides too easily; callers should skip the
# hash check below this threshold. Reference:
# docs/specs/cross-system-dedup-spec.md §6 Risks.
DEDUP_MIN_CONTENT_LENGTH = 50

_NON_WORD = re.compile(r"[^\w\s]")
_WHITESPACE = re.compile(r"\s+")


def normalise_content_for_hash(text: str) -> str:
    """Normalise text for md5 hashing.

    Matches the PostgreSQL generated column `content_items.content_text_hash`
    byte-for-byte so a client-side hash is guaranteed to match the stored
    server-side hash. Matches `lib/dedup.ts::normaliseTextForHash`.

    Pipeline: lowercase -> trim -> strip non-word/non-space -> collapse
    whitespace -> trim.
    """
    if not text:
        return ""
    out = text.lower().strip()
    out = _NON_WORD.sub("", out)
    out = _WHITESPACE.sub(" ", out)
    return out.strip()


def check_content_hash_duplicate(content_text: str) -> Tuple[bool, Optional[str]]:
    """Shared dedup gate — returns (is_duplicate, existing_item_id) on match.

    Computes md5(normalised(text)) client-side and calls the
    `find_exact_duplicates` RPC. Returns (False, None) for content below
    the length threshold, a network failure, or no match. Never raises.

    Callers in Python ingest scripts should proceed with the insert on
    match and set `dedup_status='suspected_duplicate'` per S182b Q1
    (soft block). Reference: docs/specs/cross-system-dedup-spec.md §3.2.
    """
    if not content_text:
        return False, None

    normalised = normalise_content_for_hash(content_text)
    if len(normalised) < DEDUP_MIN_CONTENT_LENGTH:
        return False, None

    content_hash = hashlib.md5(normalised.encode("utf-8")).hexdigest()

    rpc_url = f"{get_supabase_url()}/rest/v1/rpc/find_exact_duplicates"
    body = json.dumps({"p_content_hash": content_hash}).encode("utf-8")

    key = get_supabase_secret_key()
    req = urllib.request.Request(rpc_url, data=body, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if not data:
                return False, None
            first = data[0] if isinstance(data, list) else data
            existing_id = first.get("id") if isinstance(first, dict) else None
            return (existing_id is not None), existing_id
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        logger.warning("Content-hash dedup check failed (network): %s", e)
        return False, None
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning("Content-hash dedup check failed (data): %s", e)
        return False, None


def check_duplicate_url(source_url: str) -> Optional[str]:
    """Check if URL already exists. Returns existing item ID or None."""
    if not source_url:
        return None
    return check_url_exists(source_url)


def check_duplicate_embedding(
    embedding: List[float],
    threshold: float = DEDUP_SIMILARITY_THRESHOLD,
    limit: int = 3,
) -> List[dict]:
    """Check for similar content via embedding similarity.

    Returns list of matches above threshold: [{id, title, similarity}]
    """
    key = get_supabase_secret_key()

    # Use the find_similar_content function via RPC
    rpc_url = f"{get_supabase_url()}/rest/v1/rpc/find_similar_content"
    body = json.dumps({
        "query_embedding": embedding,
        "similarity_threshold": threshold,
        "limit_count": limit,
    }).encode("utf-8")

    req = urllib.request.Request(rpc_url, data=body, method="POST")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return [
                {
                    "id": item.get("id"),
                    "title": item.get("title", ""),
                    "similarity": item.get("similarity", 0),
                }
                for item in data
                if item.get("similarity", 0) >= threshold
            ]
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        logger.warning("Dedup embedding check failed (network): %s", e)
        return []
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.warning("Dedup embedding check failed (data): %s", e)
        return []


def is_duplicate(
    source_url: str = "",
    embedding: List[float] = None,
    threshold: float = DEDUP_SIMILARITY_THRESHOLD,
) -> tuple[bool, Optional[str], str]:
    """Check if content is a duplicate.

    Returns (is_dup, existing_id, method) where method is 'url' or 'embedding'.
    """
    # URL match first (fast)
    existing_id = check_duplicate_url(source_url)
    if existing_id:
        return True, existing_id, "url"

    # Embedding similarity (slower)
    if embedding:
        matches = check_duplicate_embedding(embedding, threshold)
        if matches:
            return True, matches[0]["id"], "embedding"

    return False, None, ""
