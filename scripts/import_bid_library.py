"""CLI orchestrator: Extract Q&A pairs from Word documents, dedup, classify, embed, and store.

Chains the pipeline: extract -> dedup -> classify -> embed -> store

Usage:
    python3 scripts/import_bid_library.py /path/to/docs/ [--dry-run] [--skip-embed]

Steps:
    1. Find all .docx files in the given directory
    2. Extract Q&A pairs from each using extract_docx_tables.py
    3. Run exact dedup (MD5 of normalised question text)
    4. Run near-duplicate detection, print candidates for review
    5. Classify using keyword classifier
    6. Generate embeddings using kb_pipeline/embed.py
    7. Store in Supabase using kb_pipeline/store.py
    8. Print summary
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add scripts directory to path for imports
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from extract_docx_tables import extract_qa_from_docx
from dedup import exact_dedup, find_near_duplicates
from keyword_classifier import classify_pairs, classification_summary


def find_docx_files(directory: str) -> list[str]:
    """Find all .docx files in a directory (non-recursive)."""
    p = Path(directory)
    if not p.is_dir():
        print(f"Error: '{directory}' is not a directory")
        sys.exit(1)

    files = sorted(str(f) for f in p.glob("*.docx") if not f.name.startswith("~"))
    return files


def build_content_record(pair: dict, batch_name: str) -> dict:
    """Convert a classified Q&A pair dict into a Supabase content_items record."""
    # Build the content field: combine question + answers
    content_parts = [f"Q: {pair['question_text']}"]
    if pair.get("answer_standard"):
        content_parts.append(f"Standard: {pair['answer_standard']}")
    if pair.get("answer_advanced"):
        content_parts.append(f"Advanced: {pair['answer_advanced']}")
    content = "\n\n".join(content_parts)

    # Build a concise title from the question (first 120 chars)
    title = pair["question_text"][:120]
    if len(pair["question_text"]) > 120:
        title += "..."

    record = {
        "title": title,
        "content": content,
        "content_type": "q_a_pair",
        "platform": "extraction",
        "source_url": "",
        "source_domain": "",
        "primary_domain": pair.get("primary_domain", ""),
        "primary_subtopic": pair.get("primary_subtopic", ""),
        "secondary_domain": pair.get("secondary_domain", ""),
        "secondary_subtopic": pair.get("secondary_subtopic", ""),
        "classification_confidence": pair.get("classification_confidence", 0.0),
        "ai_summary": f"Q&A pair from {pair.get('source_file', 'unknown')} — {pair.get('section_name', 'general')}",
        "ai_keywords": [
            pair.get("primary_domain", ""),
            pair.get("section_name", "").lower().replace(" ", "-"),
        ],
        "metadata": {
            "source_file": pair.get("source_file", ""),
            "section_name": pair.get("section_name", ""),
            "table_index": pair.get("table_index", 0),
            "row_index": pair.get("row_index", 0),
            "has_advanced_answer": bool(pair.get("answer_advanced")),
            "import_batch": batch_name,
        },
    }

    # Clean empty strings from ai_keywords
    record["ai_keywords"] = [k for k in record["ai_keywords"] if k]

    return record


def main():
    parser = argparse.ArgumentParser(
        description="Import bid library Q&A pairs from Word documents into Knowledge Hub"
    )
    parser.add_argument(
        "directory",
        help="Path to directory containing .docx files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Extract, dedup, and classify but do not embed or store",
    )
    parser.add_argument(
        "--skip-embed",
        action="store_true",
        help="Skip embedding generation (store without vectors)",
    )
    parser.add_argument(
        "--near-dedup-threshold",
        type=float,
        default=0.85,
        help="Similarity threshold for near-duplicate detection (default: 0.85)",
    )
    parser.add_argument(
        "--batch-name",
        type=str,
        default="",
        help="Name for this import batch (default: auto-generated)",
    )

    args = parser.parse_args()
    start_time = time.time()

    batch_name = args.batch_name or f"bid-library-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"

    print("=" * 60)
    print("Knowledge Hub — Bid Library Import")
    print("=" * 60)
    print(f"  Directory:  {args.directory}")
    print(f"  Batch:      {batch_name}")
    print(f"  Dry run:    {args.dry_run}")
    print(f"  Skip embed: {args.skip_embed}")
    print()

    # ── Step 1: Find files ──────────────────────────────────────────
    files = find_docx_files(args.directory)
    if not files:
        print("No .docx files found in the specified directory.")
        sys.exit(1)

    print(f"[1/7] Found {len(files)} .docx files:")
    for f in files:
        print(f"  - {os.path.basename(f)}")
    print()

    # ── Step 2: Extract Q&A pairs ───────────────────────────────────
    print("[2/7] Extracting Q&A pairs...")
    all_pairs = []
    for filepath in files:
        try:
            pairs = extract_qa_from_docx(filepath)
            all_pairs.extend(pairs)
            print(f"  {os.path.basename(filepath)}: {len(pairs)} pairs")
        except Exception as e:
            print(f"  {os.path.basename(filepath)}: ERROR — {e}")

    print(f"  Total extracted: {len(all_pairs)}")
    print()

    if not all_pairs:
        print("No Q&A pairs extracted. Check document formats.")
        sys.exit(1)

    # ── Step 3: Exact dedup ─────────────────────────────────────────
    print("[3/7] Running exact dedup (MD5 of normalised question text)...")
    unique_pairs, removed_pairs = exact_dedup(all_pairs)
    print(f"  Exact duplicates removed: {len(removed_pairs)}")
    print(f"  Unique pairs: {len(unique_pairs)}")
    if removed_pairs:
        print("  Removed:")
        for p in removed_pairs[:5]:
            print(f"    - [{p['source_file']}] {p['question_text'][:80]}")
        if len(removed_pairs) > 5:
            print(f"    ... and {len(removed_pairs) - 5} more")
    print()

    # ── Step 4: Near-duplicate detection ────────────────────────────
    print(f"[4/7] Detecting near-duplicates (threshold={args.near_dedup_threshold})...")
    near_dupes = find_near_duplicates(unique_pairs, threshold=args.near_dedup_threshold)
    print(f"  Near-duplicate candidates: {len(near_dupes)}")
    if near_dupes:
        print("  Top candidates (for manual review):")
        for idx_a, idx_b, score, q_a, q_b in near_dupes[:5]:
            print(f"    [{score:.3f}] #{idx_a} vs #{idx_b}")
            print(f"      A: {q_a[:80]}")
            print(f"      B: {q_b[:80]}")
        if len(near_dupes) > 5:
            print(f"    ... and {len(near_dupes) - 5} more candidates")
        print("  NOTE: Near-duplicates are flagged but NOT removed. Review manually.")
    print()

    # ── Step 5: Classify ────────────────────────────────────────────
    print("[5/7] Classifying pairs using keyword matching...")
    classified_pairs = classify_pairs(unique_pairs)
    summary = classification_summary(classified_pairs)
    print("  Classification results:")
    for domain, count in summary.items():
        print(f"    {domain}: {count}")
    print()

    # ── Step 6: Embed ───────────────────────────────────────────────
    if args.dry_run:
        print("[6/7] SKIPPED (dry run) — no embeddings generated")
        print("[7/7] SKIPPED (dry run) — no records stored")
    else:
        embed_count = 0
        store_success = 0
        store_fail = 0

        if not args.skip_embed:
            print("[6/7] Generating embeddings...")
            try:
                from kb_pipeline.embed import build_embedding_text, generate_embedding
            except ImportError as e:
                print(f"  ERROR: Could not import embedding module: {e}")
                print("  Run with --skip-embed to store without vectors.")
                sys.exit(1)

            for i, pair in enumerate(classified_pairs):
                try:
                    embed_text = build_embedding_text(
                        title=pair["question_text"][:120],
                        ai_summary=pair.get("answer_standard", "")[:500],
                        content=pair.get("answer_standard", ""),
                        content_type="q_a_pair",
                    )
                    embedding, tokens = generate_embedding(embed_text)
                    pair["_embedding"] = embedding
                    embed_count += 1
                    if (i + 1) % 10 == 0:
                        print(f"  Embedded {i + 1}/{len(classified_pairs)}")
                except Exception as e:
                    print(f"  Embed error for pair #{i}: {e}")
                    pair["_embedding"] = None

            print(f"  Embeddings generated: {embed_count}/{len(classified_pairs)}")
        else:
            print("[6/7] SKIPPED (--skip-embed) — no embeddings generated")
            for pair in classified_pairs:
                pair["_embedding"] = None

        print()

        # ── Step 7: Store ───────────────────────────────────────────
        print("[7/7] Storing in Supabase...")
        try:
            from kb_pipeline.store import insert_content_item
        except ImportError as e:
            print(f"  ERROR: Could not import store module: {e}")
            sys.exit(1)

        for i, pair in enumerate(classified_pairs):
            record = build_content_record(pair, batch_name)

            # Attach embedding if present
            if pair.get("_embedding"):
                record["embedding"] = pair["_embedding"]

            success, id_or_error = insert_content_item(record)
            if success:
                store_success += 1
                if (i + 1) % 10 == 0:
                    print(f"  Stored {i + 1}/{len(classified_pairs)}")
            else:
                store_fail += 1
                print(f"  Store error for pair #{i}: {id_or_error}")

        print(f"  Stored: {store_success}")
        if store_fail:
            print(f"  Failed: {store_fail}")

    # ── Summary ─────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    print()
    print("=" * 60)
    print("IMPORT COMPLETE")
    print("=" * 60)
    print(f"  Files processed:      {len(files)}")
    print(f"  Total extracted:      {len(all_pairs)}")
    print(f"  Exact dupes removed:  {len(removed_pairs)}")
    print(f"  Near-dupe candidates: {len(near_dupes)}")
    print(f"  Unique classified:    {len(classified_pairs)}")
    if not args.dry_run:
        print(f"  Embeddings:           {embed_count}")
        print(f"  Stored:               {store_success}")
        if store_fail:
            print(f"  Store failures:       {store_fail}")
    print(f"  Time:                 {elapsed:.1f}s ({elapsed/60:.1f}m)")
    print(f"  Batch:                {batch_name}")


if __name__ == "__main__":
    main()
