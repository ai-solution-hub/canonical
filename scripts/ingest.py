#!/usr/bin/env python3
"""
IMS Ingestion CLI — process URLs through the shared pipeline.

Usage:
    # Single URL
    python3 scripts/ingest.py https://example.com/article

    # Multiple URLs
    python3 scripts/ingest.py url1 url2 url3

    # From file (one URL per line)
    python3 scripts/ingest.py --file urls.txt

    # Dry run (extract + classify but don't store)
    python3 scripts/ingest.py --dry-run https://example.com/article

    # Skip classification (just extract + store)
    python3 scripts/ingest.py --skip-classify https://example.com/article

    # Override content type
    python3 scripts/ingest.py --type podcast https://example.com/episode
"""

import argparse
import sys
import os

# Add parent dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kb_pipeline.pipeline import process_url, process_urls


def main():
    parser = argparse.ArgumentParser(description="IMS content ingestion pipeline")
    parser.add_argument("urls", nargs="*", help="URLs to process")
    parser.add_argument("--file", "-f", help="File with URLs (one per line)")
    parser.add_argument("--dry-run", action="store_true", help="Extract + classify without storing")
    parser.add_argument("--skip-classify", action="store_true", help="Skip classification")
    parser.add_argument("--skip-embed", action="store_true", help="Skip embedding generation")
    parser.add_argument("--skip-dedup", action="store_true", help="Skip deduplication check")
    parser.add_argument("--type", dest="content_type", help="Override content_type")
    parser.add_argument("--platform", help="Override platform")
    parser.add_argument("--author", help="Override author_name")
    parser.add_argument("--batch", help="Batch name for quality logging")
    parser.add_argument("--rate-limit", type=float, default=1.5, help="Seconds between API calls")
    parser.add_argument(
        "--generate-summary", action="store_true", default=True,
        dest="generate_summary",
        help="Generate AI summary for each item (default: enabled)"
    )
    parser.add_argument(
        "--no-summary", action="store_false", dest="generate_summary",
        help="Skip AI summary generation"
    )

    args = parser.parse_args()

    # Collect URLs
    urls = list(args.urls) if args.urls else []

    if args.file:
        with open(args.file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    urls.append(line)

    if not urls:
        parser.print_help()
        sys.exit(1)

    # Deduplicate input URLs
    seen = set()
    unique_urls = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)
    if len(unique_urls) < len(urls):
        print(f"Removed {len(urls) - len(unique_urls)} duplicate input URLs")
    urls = unique_urls

    # Process
    kwargs = {}
    if args.content_type:
        kwargs["override_content_type"] = args.content_type
    if args.platform:
        kwargs["override_platform"] = args.platform
    if args.author:
        kwargs["override_author"] = args.author

    if len(urls) == 1:
        result = process_url(
            urls[0],
            batch_name=args.batch or "",
            dry_run=args.dry_run,
            skip_classify=args.skip_classify,
            skip_embed=args.skip_embed,
            skip_dedup=args.skip_dedup,
            generate_summary_flag=args.generate_summary,
            **kwargs,
        )
        if result.success:
            print(f"\nStored: {result.item_id}")
        elif result.skipped:
            print(f"\nSkipped: {result.skip_reason}")
        else:
            print(f"\nFailed: {result.error}")
            sys.exit(1)
    else:
        results = process_urls(
            urls,
            batch_name=args.batch or "",
            dry_run=args.dry_run,
            rate_limit=args.rate_limit,
            skip_classify=args.skip_classify,
            skip_embed=args.skip_embed,
            skip_dedup=args.skip_dedup,
            generate_summary_flag=args.generate_summary,
            **kwargs,
        )
        failures = sum(1 for r in results if r.error and not r.skipped)
        if failures:
            sys.exit(1)


if __name__ == "__main__":
    main()
