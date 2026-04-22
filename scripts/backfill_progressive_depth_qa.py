#!/usr/bin/env python3
"""Backfill progressive-depth columns (brief, detail, reference) for existing q_a_pair rows.

One-off script for S189 WP3. Populates the completeness dimension of the
quality score for the ~380 q_a_pair rows imported before progressive-depth
generation was wired into the ingest pipeline.

Idempotent: only writes to rows where brief IS NULL OR detail IS NULL OR
reference IS NULL. Safe to re-run — already-populated rows are skipped.

Safety guard: refuses to run against the retired project mgrmucazfiibsomdmndh.

Usage:
    # Dry run (default) — reports count without writing
    PYTHONUNBUFFERED=1 python3 scripts/backfill_progressive_depth_qa.py --dry-run

    # Live run with AI generation
    PYTHONUNBUFFERED=1 python3 scripts/backfill_progressive_depth_qa.py --live

    # Live run with deterministic-only (no AI calls, no API cost)
    PYTHONUNBUFFERED=1 python3 scripts/backfill_progressive_depth_qa.py --live --deterministic-only

    # Limit to N rows (useful for testing)
    PYTHONUNBUFFERED=1 python3 scripts/backfill_progressive_depth_qa.py --live --limit 10
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

# Ensure scripts/ is on sys.path for kb_pipeline imports
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))

from kb_pipeline.config import get_env, get_supabase_url, get_supabase_secret_key
from kb_pipeline.progressive_depth import generate_progressive_depth

logger = logging.getLogger(__name__)

# Retired project — refuse to write to it
RETIRED_PROJECT_URL_FRAGMENT = "mgrmucazfiibsomdmndh"


def _headers(prefer: str = "return=representation") -> dict[str, str]:
    """Build Supabase auth headers using service_role key."""
    key = get_supabase_secret_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _get_rows_needing_backfill(limit: int | None = None) -> list[dict]:
    """Fetch q_a_pair rows where brief/detail/reference are NULL.

    Selects id, title, content, answer_standard, answer_advanced, brief,
    detail, reference. Uses Supabase REST API with service_role key.
    """
    base_url = get_supabase_url()
    # Build query: content_type=q_a_pair AND (brief IS NULL OR detail IS NULL OR reference IS NULL)
    # Supabase REST uses or=(...) for OR conditions
    path = (
        f"{base_url}/rest/v1/content_items"
        f"?content_type=eq.q_a_pair"
        f"&or=(brief.is.null,detail.is.null,reference.is.null)"
        f"&select=id,title,content,answer_standard,answer_advanced,brief,detail,reference"
        f"&order=created_at.asc"
    )
    if limit:
        path += f"&limit={limit}"

    req = urllib.request.Request(path, headers=_headers(prefer="return=representation"))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else []
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        logger.error("Failed to fetch rows: %s %s", e.code, error_body)
        return []


def _update_row(item_id: str, updates: dict) -> bool:
    """Update a content_items row by ID. Returns True on success.

    Uses .select('id') to avoid the 204 hang (CLAUDE.md gotcha) and to
    verify exactly one row was matched (REST PATCH silent no-op gotcha).
    """
    base_url = get_supabase_url()
    path = f"{base_url}/rest/v1/content_items?id=eq.{item_id}&select=id"
    body = json.dumps(updates).encode("utf-8")
    headers = _headers(prefer="return=representation")

    req = urllib.request.Request(path, data=body, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            response_body = resp.read().decode("utf-8")
            if response_body:
                rows = json.loads(response_body)
                if isinstance(rows, list) and len(rows) == 1:
                    return True
                logger.warning(
                    "PATCH for %s returned %d rows (expected 1)",
                    item_id, len(rows) if isinstance(rows, list) else 0,
                )
                return False
            return False
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        logger.error("Failed to update %s: %s %s", item_id, e.code, error_body)
        return False


def _extract_question_from_content(content: str) -> str:
    """Extract question text from the content field (Q: prefix pattern).

    The build_content_record() in import_bid_library.py formats content as:
        Q: <question_text>
        <blank line>
        <answer_standard>
        <answer_advanced>
    """
    if not content:
        return ""
    lines = content.strip().split("\n")
    if lines and lines[0].startswith("Q: "):
        return lines[0][3:].strip()
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Backfill progressive-depth columns for existing q_a_pair rows"
    )
    mode_group = parser.add_mutually_exclusive_group(required=True)
    mode_group.add_argument(
        "--dry-run",
        action="store_true",
        help="Report count of rows needing backfill without writing",
    )
    mode_group.add_argument(
        "--live",
        action="store_true",
        help="Execute the backfill (writes to database)",
    )
    parser.add_argument(
        "--deterministic-only",
        action="store_true",
        help="Skip AI generation — use deterministic fallback only (no API cost)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of rows to process",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    # Safety guard: refuse to run against retired project
    supabase_url = get_supabase_url()
    if RETIRED_PROJECT_URL_FRAGMENT in supabase_url:
        print(
            f"ERROR: Refusing to run against retired project "
            f"({RETIRED_PROJECT_URL_FRAGMENT}). "
            f"Set SUPABASE_URL to the production project ('r') in .env."
        )
        sys.exit(1)

    print(f"Supabase URL: {supabase_url}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    if args.deterministic_only:
        print("Strategy: deterministic-only (no AI calls)")
    else:
        print("Strategy: AI generation with deterministic fallback")
    if args.limit:
        print(f"Limit: {args.limit} rows")
    print()

    # Fetch rows needing backfill
    print("Fetching q_a_pair rows with NULL progressive-depth columns...")
    rows = _get_rows_needing_backfill(limit=args.limit)
    print(f"Found {len(rows)} rows needing backfill")

    if args.dry_run:
        # Report and exit
        if rows:
            print("\nSample rows (first 5):")
            for row in rows[:5]:
                title = (row.get("title") or "")[:80]
                has_std = "yes" if row.get("answer_standard") else "no"
                has_adv = "yes" if row.get("answer_advanced") else "no"
                print(f"  {row['id'][:8]}... | std={has_std} adv={has_adv} | {title}")
        print(f"\nDry-run complete. {len(rows)} rows would be updated.")
        return

    # Live mode
    updated = 0
    skipped = 0
    errors = 0
    use_ai = not args.deterministic_only

    for i, row in enumerate(rows):
        item_id = row["id"]

        # Extract question_text — prefer content field Q: prefix pattern
        question_text = _extract_question_from_content(row.get("content", ""))
        if not question_text:
            # Fallback to title (which is truncated question)
            question_text = row.get("title", "")

        answer_standard = row.get("answer_standard")
        answer_advanced = row.get("answer_advanced")

        result = generate_progressive_depth(
            question_text=question_text,
            answer_standard=answer_standard,
            answer_advanced=answer_advanced,
            content_type="q_a_pair",
            use_ai=use_ai,
        )

        if result is None:
            skipped += 1
            if (i + 1) % 20 == 0:
                print(f"  Progress: {i + 1}/{len(rows)} (updated={updated}, skipped={skipped}, errors={errors})")
            continue

        if _update_row(item_id, result):
            updated += 1
        else:
            errors += 1
            logger.warning("Failed to update row %s", item_id)

        if (i + 1) % 20 == 0:
            print(f"  Progress: {i + 1}/{len(rows)} (updated={updated}, skipped={skipped}, errors={errors})")

    print(f"\nBackfill complete.")
    print(f"  Total rows: {len(rows)}")
    print(f"  Updated:    {updated}")
    print(f"  Skipped:    {skipped}")
    print(f"  Errors:     {errors}")


if __name__ == "__main__":
    main()
