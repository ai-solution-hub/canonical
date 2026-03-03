"""Deduplication — URL matching + embedding similarity."""

import json
import logging
import urllib.error
import urllib.request
from typing import Optional, List

from .store import check_url_exists
from .config import DEDUP_SIMILARITY_THRESHOLD, get_env, SUPABASE_URL

logger = logging.getLogger(__name__)


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
    env = get_env()
    key = env["SUPABASE_ANON_KEY"]

    # Use the find_similar_content function via RPC
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/find_similar_content"
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
