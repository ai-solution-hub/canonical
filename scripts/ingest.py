#!/usr/bin/env python3
"""
Knowledge Hub Ingestion CLI — process URLs through the shared pipeline.

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
    python3 scripts/ingest.py --type research https://example.com/paper
"""

import argparse
import sys
import os

# Add parent dir to path so we can import kb_pipeline
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kb_pipeline.pipeline import process_url, process_urls

# Per WP-S5.2 spec v1.1 §7.2 + §9 D-23 item 2: --env=prod flag asserts
# SUPABASE_URL contains the prod project ref before any DB writes. Highest-
# risk Python entry point — accidental staging-write would break the
# data-empty assumption.
PROD_PROJECT_URL_FRAGMENT = "rovrymhhffssilaftdwd"


def main():
    parser = argparse.ArgumentParser(description="Knowledge Hub content ingestion pipeline")
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
        "--smoke-test", action="store_true",
        help="No-op smoke test: import + env-validation only, exit 0. "
             "Used by Cloud Run firstinvoke verification to prove the "
             "boot chain is GREEN without performing any DB writes."
    )
    parser.add_argument(
        "--no-summary", action="store_false", dest="generate_summary",
        help="Skip AI summary generation"
    )
    parser.add_argument(
        "--static-taxonomy", action="store_true",
        help="Use static taxonomy from prompt file instead of fetching from DB"
    )
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

    # Env assertion — must run before any DB writes. kb_pipeline.config
    # has loaded .env.local into os.environ at import time (see §8.1
    # D-20=α); shell-exported SUPABASE_URL still wins by python-dotenv
    # default (override=False), so this checks the resolved value.
    # Only enforced for --env=prod so default --env=auto preserves the
    # legacy behaviour (defer URL fetch to pipeline write-time).
    if args.env == "prod":
        from kb_pipeline.config import get_supabase_url
        url = get_supabase_url()
        if PROD_PROJECT_URL_FRAGMENT not in url:
            sys.exit(
                f"--env=prod set but SUPABASE_URL does not contain "
                f"'{PROD_PROJECT_URL_FRAGMENT}'. Run with explicit override:\n"
                f"  SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-key> "
                f"python3 scripts/ingest.py"
            )

    if args.static_taxonomy:
        from kb_pipeline.config import set_static_taxonomy
        set_static_taxonomy(True)

    # No-op smoke test (Cloud Run firstinvoke verification — see Phase 2
    # close-out in docs/runbooks/cloud-run-phase-1-handover.md §8.3).
    # Validates env-mount + import chain, exits 0 without DB writes.
    if args.smoke_test:
        print("smoke-test: env + imports OK")
        sys.exit(0)

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
