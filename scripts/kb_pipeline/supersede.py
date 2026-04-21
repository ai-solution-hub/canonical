"""Shared setter for the supersession model (S186 WP-B.2 — Python side).

Mirror of `lib/supersession/set.ts`. Same validation + write semantics so
TS and Python callers agree.

TS ⇄ Python parity notes (B.2 verifier M1/L3/L5):
  * `SupersessionError.context` keys are snake_case here (`old_id`,
    `existing_superseded_by`); the TS equivalent uses camelCase. Each
    language follows its own idiom — callers are language-local so no
    cross-boundary inspection happens.
  * TS loads old + new rows concurrently via `Promise.all`; Python does
    it sequentially. Observable error codes are identical (OLD_NOT_FOUND
    wins when both are missing), so the divergence is latency-only.
  * Error messages include raw UUIDs. This is safe because supersession
    is admin-only per spec §6; callers that might surface the message
    to non-admins MUST strip IDs.

Concurrency note (B.2 verifier L2 — TOCTOU):
  Two concurrent callers can both pass the OLD_ALREADY_SUPERSEDED
  validation, then both issue the PATCH. The second PATCH wins and
  silently overwrites `superseded_by` with a different `new_id`. The
  DB CHECK only prevents self-ref, not conflicting-pointer races.
  Acceptable pre-launch because supersession is admin-only + low
  volume; revisit post-launch if audit evidence shows the race.

Spec:  docs/specs/supersession-model-spec.md §5.4
Plan:  docs/plans/supersession-model-plan.md §B.2
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional, Tuple

from .config import get_supabase_secret_key, get_supabase_url

logger = logging.getLogger(__name__)

SupersessionErrorCode = str

_VALID_CODES = frozenset(
    {
        "SAME_ID",
        "OLD_NOT_FOUND",
        "NEW_NOT_FOUND",
        "OLD_ALREADY_SUPERSEDED",
        "NEW_ALREADY_SUPERSEDED",
    }
)


class SupersessionError(Exception):
    """Validation failure during `set_supersession`.

    `code` mirrors the TS `SupersessionErrorCode` enum so error handling
    is symmetric across languages.
    """

    def __init__(
        self,
        code: SupersessionErrorCode,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        if code not in _VALID_CODES:
            raise ValueError(f"Unknown SupersessionError code: {code}")
        self.code = code
        self.context = context or {}


def _headers() -> Dict[str, str]:
    key = get_supabase_secret_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


# Sentinel status codes returned alongside data=None:
#   200/206 + data=None  => row genuinely does not exist
#   -1                    => network / URLError (opaque)
#   4xx/5xx               => HTTP error from PostgREST
# Only 200/206 should be interpreted as "not found" by the caller; anything
# else must surface as RuntimeError (M3 verifier fix — previously returned 0
# for URLError which collided with the not-found branch).
_URLERROR_STATUS: int = -1


def _fetch_row(item_id: str) -> Tuple[int, Optional[Dict[str, Any]]]:
    """GET the minimal fields needed for supersession validation + response."""
    path = (
        f"content_items?id=eq.{urllib.parse.quote(item_id, safe='')}"
        f"&select=id,title,superseded_by,dedup_status"
    )
    url = f"{get_supabase_url()}/rest/v1/{path}"
    req = urllib.request.Request(url, method="GET")
    for k, v in _headers().items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body) if body else []
            if isinstance(data, list) and data:
                return resp.status, data[0]
            return resp.status, None
    except urllib.error.HTTPError as e:
        logger.warning(
            "set_supersession: fetch failed for %s: %s %s",
            item_id,
            e.code,
            (e.read().decode("utf-8") if e.fp else ""),
        )
        return e.code, None
    except urllib.error.URLError as e:
        logger.warning("set_supersession: fetch network error for %s: %s", item_id, e)
        return _URLERROR_STATUS, None


def _update_old_row(
    old_id: str, new_id: str
) -> Tuple[int, Optional[Dict[str, Any]]]:
    """PATCH old row — superseded_by + dedup_status in one call.

    Selects only the four columns the caller serialises back to the result
    shape, matching `lib/supersession/set.ts` (M2 verifier fix — previous
    revision returned the full row via `Prefer: return=representation`).
    """
    path = (
        f"content_items?id=eq.{urllib.parse.quote(old_id, safe='')}"
        f"&select=id,title,superseded_by,dedup_status"
    )
    url = f"{get_supabase_url()}/rest/v1/{path}"
    body = json.dumps(
        {
            "superseded_by": new_id,
            "dedup_status": "superseded",
        }
    ).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="PATCH")
    for k, v in _headers().items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else []
            if isinstance(data, list) and data:
                return resp.status, data[0]
            return resp.status, None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if e.fp else ""
        logger.warning(
            "set_supersession: PATCH failed for %s: %s %s", old_id, e.code, err_body
        )
        return e.code, None
    except urllib.error.URLError as e:
        logger.warning("set_supersession: PATCH network error for %s: %s", old_id, e)
        return _URLERROR_STATUS, None


def set_supersession(
    old_id: str,
    new_id: str,
    actor_user_id: str,
) -> Dict[str, Any]:
    """Mark `old_id` as superseded by `new_id`.

    Validates:
      * oldId != newId (SAME_ID)
      * both rows exist (OLD_NOT_FOUND / NEW_NOT_FOUND)
      * neither row already has `superseded_by` set (OLD_ALREADY_SUPERSEDED,
        NEW_ALREADY_SUPERSEDED — prevents chains in both directions)

    Writes: old row `superseded_by=new_id` + `dedup_status='superseded'`.
    Logs a `[supersession.set]` line with both IDs + titles + actor.

    Raises:
      SupersessionError  — for any validation failure.
      RuntimeError       — for unexpected DB failures (fetch/update).

    Returns:
      dict with `oldItem` + `newItem` snapshots (matches TS return shape).
    """
    if old_id == new_id:
        raise SupersessionError(
            "SAME_ID",
            "Cannot supersede an item with itself",
            {"old_id": old_id, "new_id": new_id},
        )

    # Only treat 200/206 + empty list as "not found". Any other status (HTTP
    # error, URLError sentinel) must surface as RuntimeError — a network
    # outage is not the same outcome as "row does not exist" (M3 fix).
    old_status, old_row = _fetch_row(old_id)
    if old_row is None:
        if old_status in (200, 206):
            raise SupersessionError(
                "OLD_NOT_FOUND",
                f"Old item not found: {old_id}",
                {"old_id": old_id},
            )
        raise RuntimeError(
            f"set_supersession: old-row fetch failed with status {old_status}"
        )

    new_status, new_row = _fetch_row(new_id)
    if new_row is None:
        if new_status in (200, 206):
            raise SupersessionError(
                "NEW_NOT_FOUND",
                f"New item not found: {new_id}",
                {"new_id": new_id},
            )
        raise RuntimeError(
            f"set_supersession: new-row fetch failed with status {new_status}"
        )

    if old_row.get("superseded_by"):
        raise SupersessionError(
            "OLD_ALREADY_SUPERSEDED",
            f"Old item {old_id} is already superseded by {old_row['superseded_by']}",
            {
                "old_id": old_id,
                "existing_superseded_by": old_row["superseded_by"],
            },
        )
    if new_row.get("superseded_by"):
        raise SupersessionError(
            "NEW_ALREADY_SUPERSEDED",
            (
                f"New item {new_id} is already superseded by "
                f"{new_row['superseded_by']}; cannot form a chain"
            ),
            {
                "new_id": new_id,
                "existing_superseded_by": new_row["superseded_by"],
            },
        )

    update_status, updated = _update_old_row(old_id, new_id)
    if updated is None:
        raise RuntimeError(
            f"set_supersession: UPDATE failed with status {update_status}"
        )

    logger.info(
        "[supersession.set] %s superseded by %s (actor=%s, old_title=%r, new_title=%r)",
        old_id,
        new_id,
        actor_user_id,
        old_row.get("title"),
        new_row.get("title"),
    )

    return {
        "oldItem": {
            "id": updated.get("id"),
            "title": updated.get("title"),
            "superseded_by": updated.get("superseded_by"),
            "dedup_status": updated.get("dedup_status"),
        },
        "newItem": {
            "id": new_row.get("id"),
            "title": new_row.get("title"),
            "superseded_by": new_row.get("superseded_by"),
            "dedup_status": new_row.get("dedup_status"),
        },
    }
