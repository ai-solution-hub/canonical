"""Clean up tripled metadata.section_name values in content_items.

Fixes pandoc Track Changes artefacts where heading text is repeated 2-3x
(e.g. "Product SupportProduct SupportProduct Support" -> "Product Support").

Usage:
    python3 scripts/cleanup_section_names.py [--dry-run]
"""

import argparse
import json
import logging
import os
import re
import sys
import urllib.parse
import urllib.request
import urllib.error

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from kb_pipeline.config import get_supabase_url, get_supabase_secret_key

# Per WP-S5.3 D-21 F-1: --env=prod flag asserts SUPABASE_URL contains
# the prod project ref before any DB writes.
PROD_PROJECT_URL_FRAGMENT = "rovrymhhffssilaftdwd"


def deduplicate_repeated_text(text: str) -> str:
    """Remove repeated heading text caused by Track Changes artefacts.

    Handles cases where text is repeated 2-3x:
    - "Product SupportProduct SupportProduct Support" -> "Product Support"
    - "Data EncryptionData Encryption" -> "Data Encryption"
    """
    text = text.strip()
    if not text:
        return text

    # Try tripled first, then doubled
    for n in [3, 2]:
        length = len(text)
        if length < n * 3:  # Minimum 3 chars per repetition
            continue
        # Try different chunk sizes
        for chunk_len in range(3, length // n + 1):
            chunk = text[:chunk_len].rstrip()
            repeated = (chunk * n)
            # Allow some trailing whitespace variation
            if text.rstrip() == repeated.rstrip() or text.replace(" ", "") == (chunk.replace(" ", "") * n):
                return chunk
            # Handle spaces between repetitions
            spaced = (" ".join([chunk] * n))
            if text.rstrip() == spaced.rstrip():
                return chunk

    return text


def fetch_items_with_section_names():
    """Fetch all content items that have a section_name in metadata."""
    key = get_supabase_secret_key()
    url = (
        f"{get_supabase_url()}/rest/v1/content_items"
        f"?metadata->>section_name=not.is.null"
        f"&select=id,metadata"
        f"&limit=1000"
    )

    req = urllib.request.Request(url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")

    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def update_item_metadata(item_id: str, metadata: dict):
    """Update an item's metadata via Supabase REST API."""
    key = get_supabase_secret_key()
    url = (
        f"{get_supabase_url()}/rest/v1/content_items"
        f"?id=eq.{item_id}"
    )

    data = json.dumps({"metadata": metadata}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PATCH")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=minimal")

    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status


def main():
    parser = argparse.ArgumentParser(
        description="Clean up tripled metadata.section_name values"
    )
    parser.add_argument("--dry-run", action="store_true", help="Show changes without applying")
    parser.add_argument(
        "--env",
        choices=["prod", "staging", "auto"],
        default="auto",
        help=(
            "With --env=prod, asserts SUPABASE_URL points at prod and "
            "refuses to run otherwise. --env=staging and --env=auto "
            "are non-asserting (trust env). Default 'auto'."
        ),
    )
    args = parser.parse_args()

    if args.env == "prod":
        url = get_supabase_url()
        if PROD_PROJECT_URL_FRAGMENT not in url:
            sys.exit(
                f"--env=prod set but SUPABASE_URL does not contain "
                f"'{PROD_PROJECT_URL_FRAGMENT}'. Run with explicit override:\n"
                f"  SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> "
                f"python3 scripts/cleanup_section_names.py"
            )

    print("Fetching items with section_name metadata...")
    items = fetch_items_with_section_names()
    print(f"Found {len(items)} items with section_name")

    changes = []
    for item in items:
        metadata = item.get("metadata", {})
        section_name = metadata.get("section_name", "")
        if not section_name:
            continue

        cleaned = deduplicate_repeated_text(section_name)
        if cleaned != section_name:
            changes.append({
                "id": item["id"],
                "old": section_name,
                "new": cleaned,
                "metadata": metadata,
            })

    print(f"\nFound {len(changes)} items needing cleanup:")
    for c in changes:
        print(f"  [{c['id'][:8]}] \"{c['old']}\" -> \"{c['new']}\"")

    if not changes:
        print("No changes needed.")
        return

    if args.dry_run:
        print(f"\nDRY RUN — {len(changes)} items would be updated.")
        return

    print(f"\nApplying {len(changes)} updates...")
    success = 0
    for c in changes:
        c["metadata"]["section_name"] = c["new"]
        try:
            update_item_metadata(c["id"], c["metadata"])
            success += 1
        except Exception as e:
            print(f"  ERROR updating {c['id']}: {e}")

    print(f"Updated {success}/{len(changes)} items.")


if __name__ == "__main__":
    main()
