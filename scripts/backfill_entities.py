#!/usr/bin/env python3
"""Backfill entity mentions for existing content items.

Uses keyword-based entity extraction (no AI calls) to find known entities
in content items that have no entity_mentions records.

Usage:
    python3 scripts/backfill_entities.py [--dry-run] [--limit N] [--verbose]

Examples:
    python3 scripts/backfill_entities.py --dry-run          # Preview what would be stored
    python3 scripts/backfill_entities.py --limit 50         # Process first 50 items
    python3 scripts/backfill_entities.py                    # Process all items without entities
"""

import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request

# Add scripts dir to path for kb_pipeline imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kb_pipeline.classify import (
    extract_entities_by_keyword,
    load_entity_aliases,
    store_entities,
)
from kb_pipeline.config import get_supabase_url, get_supabase_secret_key

logger = logging.getLogger(__name__)


def fetch_items_without_entities(limit: int = 1000) -> list:
    """Fetch content items that have no entity_mentions records.

    Uses a LEFT JOIN via PostgREST to find items where entity_mentions
    is empty. Falls back to a two-query approach if the join is not
    supported.

    Args:
        limit: Maximum number of items to return.

    Returns:
        List of dicts with id, title, content.
    """
    url_base = get_supabase_url()
    key = get_supabase_secret_key()

    # Fetch all content item IDs that DO have entity mentions
    mentions_url = (
        f"{url_base}/rest/v1/entity_mentions"
        "?select=content_item_id"
    )
    req = urllib.request.Request(mentions_url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")

    items_with_entities = set()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items_with_entities = {row["content_item_id"] for row in data if row.get("content_item_id")}
    except Exception as e:
        logger.warning("Failed to fetch entity_mentions IDs: %s", e)

    # Fetch all active content items
    all_items = []
    page_size = 100
    offset = 0

    while len(all_items) < limit:
        items_url = (
            f"{url_base}/rest/v1/content_items"
            "?select=id,title,content"
            "&order=created_at.asc"
        )
        req = urllib.request.Request(items_url)
        req.add_header("apikey", key)
        req.add_header("Authorization", f"Bearer {key}")
        req.add_header("Range", f"{offset}-{offset + page_size - 1}")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if not data:
                    break
                # Filter out items that already have entities
                for item in data:
                    if item["id"] not in items_with_entities:
                        all_items.append(item)
                if len(data) < page_size:
                    break
                offset += page_size
        except urllib.error.HTTPError as e:
            logger.warning("HTTP %s fetching content_items (offset=%d): %s", e.code, offset, e.reason)
            break

    return all_items[:limit]


def main():
    parser = argparse.ArgumentParser(
        description="Backfill entity mentions for content items using keyword extraction."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview entities without storing them.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=1000,
        help="Maximum number of items to process (default: 1000).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show detailed output per item.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    print(f"\n{'='*60}")
    print("Entity Backfill — Keyword-Based Extraction")
    print(f"{'='*60}")
    print(f"  Dry run: {args.dry_run}")
    print(f"  Limit:   {args.limit}")

    # Load entity aliases from DB
    print("\n  Loading entity aliases from DB...")
    aliases = load_entity_aliases()
    print(f"  Loaded {len(aliases)} aliases")

    # Fetch items without entities
    print("\n  Fetching items without entity mentions...")
    items = fetch_items_without_entities(limit=args.limit)
    print(f"  Found {len(items)} items to process")

    if not items:
        print("\n  No items need entity backfill. Done.")
        return

    # Process each item
    total_stored = 0
    total_skipped = 0
    items_with_entities = 0
    items_without_entities = 0

    for idx, item in enumerate(items):
        item_id = item["id"]
        title = item.get("title", "(no title)")
        content = item.get("content", "")

        # Combine title and content for scanning
        combined_text = f"{title} {content}"
        entities = extract_entities_by_keyword(combined_text)

        if not entities:
            items_without_entities += 1
            if args.verbose:
                print(f"  [{idx + 1}/{len(items)}] {title[:60]} — no entities found")
            continue

        items_with_entities += 1

        if args.verbose or args.dry_run:
            entity_names = [f"{e['canonical_name']} ({e['entity_type']})" for e in entities]
            print(f"  [{idx + 1}/{len(items)}] {title[:60]}")
            print(f"           Entities: {', '.join(entity_names)}")

        if not args.dry_run:
            stored, skipped = store_entities(item_id, entities)
            total_stored += stored
            total_skipped += skipped

    # Summary
    print(f"\n{'='*60}")
    print("BACKFILL COMPLETE")
    print(f"{'='*60}")
    print(f"  Items processed:       {len(items)}")
    print(f"  Items with entities:   {items_with_entities}")
    print(f"  Items without matches: {items_without_entities}")
    if not args.dry_run:
        print(f"  Entities stored:       {total_stored}")
        print(f"  Entities skipped:      {total_skipped}")
    else:
        print(f"  (dry run — nothing stored)")


if __name__ == "__main__":
    main()
