#!/usr/bin/env python3
"""Backfill entity extraction for Q&A items that were ingested without --entities.

Background: Stage 1 re-ingestion (S180 WP2) ran import_bid_library.py without
the --entities flag, leaving 222 q_a_pair items without canonical_name
extraction. This script calls classify() per item (AI pass), then stores
entities + relationships. Existing classification fields on content_items are
not touched — only entity_mentions + entity_relationships inserts.

Idempotent: store_entities / store_relationships honour UNIQUE constraints
and skip duplicates on re-run.

Usage:
    python3 scripts/backfill_entities_qa.py [--limit N] [--dry-run] [--force]
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env", override=False)

from supabase import create_client

from kb_pipeline.classify import (
    classify as ai_classify,
    store_entities,
    store_relationships,
    load_entity_aliases,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0, help="Limit number of items (0 = all)")
    parser.add_argument("--dry-run", action="store_true", help="Classify only; do not write entities")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-process items that already have entities (default skips them)",
    )
    parser.add_argument(
        "--content-type",
        default="q_a_pair",
        help="content_type filter (default q_a_pair)",
    )
    args = parser.parse_args()

    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    sb = create_client(url, key)

    # Load items of target content_type (paginate — 222 items fits one page
    # but future runs on bigger corpora need batching).
    all_items: list[dict] = []
    batch_size = 1000
    offset = 0
    while True:
        resp = (
            sb.table("content_items")
            .select("id,title,content")
            .eq("content_type", args.content_type)
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        all_items.extend(rows)
        if len(rows) < batch_size:
            break
        offset += batch_size

    print(f"Found {len(all_items)} items with content_type={args.content_type}", flush=True)

    # Exclude items that already have entities unless --force.
    if not args.force:
        mentions = (
            sb.table("entity_mentions").select("content_item_id").execute().data or []
        )
        existing = {m["content_item_id"] for m in mentions}
        before = len(all_items)
        all_items = [i for i in all_items if i["id"] not in existing]
        print(f"Skipping {before - len(all_items)} items that already have entities", flush=True)

    if args.limit > 0:
        all_items = all_items[: args.limit]
        print(f"Limited to {len(all_items)} items", flush=True)

    if not all_items:
        print("Nothing to do.")
        return 0

    load_entity_aliases()

    t0 = time.time()
    entity_count = 0
    rel_count = 0
    errors = 0
    processed = 0

    for item in all_items:
        try:
            content = item.get("content") or ""
            if not content.strip():
                continue
            cls = ai_classify(
                title=item["title"] or "",
                content=content,
                content_type=args.content_type,
                platform="extraction",
            )
            if args.dry_run:
                entity_count += len(cls.entities)
                rel_count += len(cls.relationships)
            else:
                if cls.entities:
                    stored, _ = store_entities(item["id"], cls.entities)
                    entity_count += stored
                if cls.relationships:
                    r, _ = store_relationships(item["id"], cls.relationships)
                    rel_count += r
            processed += 1
            if processed % 10 == 0:
                elapsed = time.time() - t0
                rate = processed / elapsed if elapsed > 0 else 0
                eta = (len(all_items) - processed) / rate if rate > 0 else 0
                print(
                    f"  {processed}/{len(all_items)}  entities={entity_count} "
                    f"rels={rel_count}  rate={rate:.2f}/s  eta={eta:.0f}s",
                    flush=True,
                )
        except Exception as e:  # noqa: BLE001
            errors += 1
            print(f"  ERROR item {item['id']}: {e}", flush=True)

    elapsed = time.time() - t0
    print()
    print("=" * 60)
    print("BACKFILL COMPLETE")
    print("=" * 60)
    print(f"  Items processed: {processed}/{len(all_items)}")
    print(f"  Errors:          {errors}")
    print(f"  Entities stored: {entity_count}{' (dry-run)' if args.dry_run else ''}")
    print(f"  Relationships:   {rel_count}{' (dry-run)' if args.dry_run else ''}")
    print(f"  Elapsed:         {elapsed:.0f}s  ({processed / elapsed:.2f} items/s)")
    return 0 if errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
