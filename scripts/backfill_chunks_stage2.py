#!/usr/bin/env python3
"""Backfill content_chunks for Stage 2 client-new-markdown-2026 items.

Stage 2 ingest (S180 scripts/ingest_stage2_markdown.py) stored embeddings
on content_items but did not call store_chunks per insert, so the 220
client-new-markdown items are invisible to MCP search_content_chunks.

This one-shot backfill iterates content_items where
user_tags @> ['client-new-markdown-2026'], calls the same store_chunks
helper used by import_bid_library.py + ingest_markdown.py, and logs
totals.

Usage:
    python3 scripts/backfill_chunks_stage2.py [--dry-run] [--limit N]

Idempotent — store_chunks deletes existing chunks before inserting.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env", override=False)

from supabase import create_client

from kb_pipeline.chunk import store_chunks

BATCH_TAG = "client-new-markdown-2026"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def get_supabase_client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_PUBLISHABLE_KEY"]
    return create_client(url, key)


def fetch_stage2_items(client, limit: int | None) -> list[dict]:
    """Page through content_items where user_tags @> ['client-new-markdown-2026']."""
    page = 0
    page_size = 100
    items: list[dict] = []
    while True:
        start = page * page_size
        end = start + page_size - 1
        query = (
            client.table("content_items")
            .select("id, title, content, content_type")
            .contains("user_tags", [BATCH_TAG])
            .order("created_at")
            .range(start, end)
        )
        result = query.execute()
        rows = result.data or []
        items.extend(rows)
        if len(rows) < page_size:
            break
        if limit is not None and len(items) >= limit:
            items = items[:limit]
            break
        page += 1
    return items


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="List items, do not chunk")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N items")
    args = parser.parse_args()

    client = get_supabase_client()
    items = fetch_stage2_items(client, args.limit)
    log.info("Found %d Stage 2 items tagged %s", len(items), BATCH_TAG)

    if args.dry_run:
        for item in items[:5]:
            log.info(
                "  %s  [%s]  %s  (content len=%d)",
                item["id"],
                item.get("content_type"),
                (item.get("title") or "")[:60],
                len(item.get("content") or ""),
            )
        if len(items) > 5:
            log.info("  ... %d more", len(items) - 5)
        log.info("Dry run — no chunks written.")
        return 0

    total_chunks = 0
    total_errors = 0
    items_with_chunks = 0
    items_with_zero_chunks: list[str] = []
    started = time.time()

    for i, item in enumerate(items, start=1):
        content = item.get("content") or ""
        if not content.strip():
            log.warning("  Item %s has empty content — skipping", item["id"])
            items_with_zero_chunks.append(item["id"])
            continue

        try:
            stored, errors = store_chunks(item["id"], content)
        except Exception as e:
            log.error("  Item %s store_chunks failed: %s", item["id"], e)
            total_errors += 1
            continue

        if stored == 0:
            # Either content < MIN_DOCUMENT_CHARS or no headings produced chunks.
            items_with_zero_chunks.append(item["id"])
        else:
            items_with_chunks += 1
            total_chunks += stored
        for err in errors:
            log.warning("  [%s] %s", item["id"], err)
            total_errors += 1

        if i % 25 == 0:
            elapsed = time.time() - started
            log.info(
                "  Progress: %d/%d  chunks=%d  errors=%d  (%.1fs)",
                i,
                len(items),
                total_chunks,
                total_errors,
                elapsed,
            )

    log.info("=" * 60)
    log.info("Stage 2 chunk backfill complete in %.1fs", time.time() - started)
    log.info("  Items processed:        %d", len(items))
    log.info("  Items with >=1 chunk:   %d", items_with_chunks)
    log.info("  Items with 0 chunks:    %d", len(items_with_zero_chunks))
    log.info("  Total chunks stored:    %d", total_chunks)
    log.info("  Errors:                 %d", total_errors)

    if items_with_zero_chunks:
        log.info(
            "  First 5 zero-chunk item IDs: %s",
            ", ".join(items_with_zero_chunks[:5]),
        )

    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
