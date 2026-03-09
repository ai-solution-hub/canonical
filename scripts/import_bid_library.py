"""CLI orchestrator: Extract Q&A pairs from Word documents, dedup, classify, embed, and store.

Chains the pipeline: extract -> dedup -> classify -> embed -> store

Usage:
    python3 scripts/import_bid_library.py /path/to/docs/ [--dry-run] [--skip-embed] [--force]

Steps:
    1. Find all .docx files in the given directory
    2. Extract Q&A pairs from each using extract_docx_tables.py
    3. Run exact dedup (MD5 of normalised question text)
    4. Run near-duplicate detection, print candidates for review
    5. Classify using keyword classifier
    6. Check for existing records in Supabase (idempotency)
    7. Generate embeddings using kb_pipeline/embed.py
    8. Store in Supabase using kb_pipeline/store.py
    9. Print summary with quality report
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# Add scripts directory to path for imports
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from extract_docx_tables import extract_qa_from_docx
from dedup import exact_dedup, find_near_duplicates
from keyword_classifier import classify_pairs, classification_summary


# ── Quality thresholds ─────────────────────────────────────────────────
FRAGMENT_THRESHOLD = 20  # Content shorter than this is flagged as a fragment


def truncate_at_word_boundary(text: str, max_length: int, suffix: str = "...") -> str:
    """Truncate text at a word boundary near max_length.

    Finds the last space before max_length and truncates there, unless
    doing so would lose more than 30% of the allowed length (in which
    case the hard cut is used). Appends suffix if truncated.
    """
    if len(text) <= max_length:
        return text
    truncated = text[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > max_length * 0.7:
        truncated = truncated[:last_space]
    return truncated.rstrip() + suffix


def find_docx_files(directory: str) -> list[str]:
    """Find all .docx files in a directory (non-recursive)."""
    p = Path(directory)
    if not p.is_dir():
        print(f"Error: '{directory}' is not a directory")
        sys.exit(1)

    files = sorted(str(f) for f in p.glob("*.docx") if not f.name.startswith("~"))
    return files


def check_question_exists(question_text: str) -> bool:
    """Check if a Q&A pair with this question already exists in Supabase.

    Matches against the title field (which contains the question text)
    for content_type='q_a_pair' records.
    """
    from kb_pipeline.config import get_supabase_url, get_supabase_secret_key

    # Use first 80 chars of the question for matching — enough to be unique
    # without hitting URL length limits
    search_text = question_text[:80].strip()
    if not search_text:
        return False

    key = get_supabase_secret_key()
    encoded_text = urllib.parse.quote(search_text, safe="")
    url = (
        f"{get_supabase_url()}/rest/v1/content_items"
        f"?content_type=eq.q_a_pair"
        f"&title=ilike.*{encoded_text}*"
        f"&select=id"
        f"&limit=1"
    )

    req = urllib.request.Request(url)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return len(data) > 0
    except Exception:
        return False


def validate_content_quality(content: str, question_text: str) -> dict:
    """Validate content quality and return a quality report dict.

    Returns:
        dict with keys: is_empty (bool), is_fragment (bool), content_length (int)
    """
    content_stripped = content.strip()
    return {
        "is_empty": len(content_stripped) == 0,
        "is_fragment": 0 < len(content_stripped) < FRAGMENT_THRESHOLD,
        "content_length": len(content_stripped),
    }


def build_content_record(pair: dict, batch_name: str) -> dict:
    """Convert a classified Q&A pair dict into a Supabase content_items record."""
    # Build the content field: question + answer text for search indexing
    content_parts = []
    content_parts.append(f"Q: {pair['question_text']}")
    content_parts.append("")  # blank line separator
    if pair.get("answer_standard"):
        content_parts.append(pair["answer_standard"])
    if pair.get("answer_advanced"):
        content_parts.append(pair["answer_advanced"])
    content = "\n".join(content_parts) if content_parts else ""

    # Build a concise title from the question (word-boundary-aware)
    title = truncate_at_word_boundary(pair["question_text"], 120)

    # Build ai_summary from answer text (word-boundary-aware)
    answer_text = ""
    if pair.get("answer_standard"):
        answer_text = pair["answer_standard"]
    if pair.get("answer_advanced"):
        if answer_text:
            answer_text += "\n" + pair["answer_advanced"]
        else:
            answer_text = pair["answer_advanced"]
    ai_summary = truncate_at_word_boundary(answer_text, 200)

    record = {
        "title": title,
        "content": content,
        "answer_standard": pair.get("answer_standard") or None,
        "answer_advanced": pair.get("answer_advanced") or None,
        "content_type": "q_a_pair",
        "platform": "extraction",
        "source_url": "",
        "source_domain": "",
        "primary_domain": pair.get("primary_domain", ""),
        "primary_subtopic": pair.get("primary_subtopic", ""),
        "secondary_domain": pair.get("secondary_domain", ""),
        "secondary_subtopic": pair.get("secondary_subtopic", ""),
        "classification_confidence": pair.get("classification_confidence", 0.0),
        "ai_summary": ai_summary,
        "ai_keywords": [
            pair.get("primary_domain", ""),
            pair.get("section_name", "").lower().replace(" ", "-"),
        ],
        "metadata": {
            "source_file": pair.get("source_file", ""),
            "section_name": pair.get("section_name", ""),
            "table_index": pair.get("table_index", 0),
            "row_index": pair.get("row_index", 0),
            "has_standard": bool(pair.get("answer_standard")),
            "has_advanced": bool(pair.get("answer_advanced")),
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
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip idempotency check — import even if matching records exist",
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
    print(f"  Force:      {args.force}")
    print()

    # ── Step 1: Find files ──────────────────────────────────────────
    files = find_docx_files(args.directory)
    if not files:
        print("No .docx files found in the specified directory.")
        sys.exit(1)

    print(f"[1/9] Found {len(files)} .docx files:")
    for f in files:
        print(f"  - {os.path.basename(f)}")
    print()

    # ── Step 2: Extract Q&A pairs ───────────────────────────────────
    print("[2/9] Extracting Q&A pairs...")
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
    print("[3/9] Running exact dedup (MD5 of normalised question text)...")
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
    print(f"[4/9] Detecting near-duplicates (threshold={args.near_dedup_threshold})...")
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
    print("[5/9] Classifying pairs using keyword matching...")
    classified_pairs = classify_pairs(unique_pairs)
    summary = classification_summary(classified_pairs)
    print("  Classification results:")
    for domain, count in summary.items():
        print(f"    {domain}: {count}")
    print()

    # ── Step 6: Quality validation ──────────────────────────────────
    print("[6/9] Validating content quality...")
    quality_empty = []
    quality_fragments = []
    for i, pair in enumerate(classified_pairs):
        record = build_content_record(pair, batch_name)
        quality = validate_content_quality(record["content"], pair["question_text"])
        if quality["is_empty"]:
            quality_empty.append((i, pair["question_text"][:80]))
        elif quality["is_fragment"]:
            quality_fragments.append((i, pair["question_text"][:80], quality["content_length"]))

    if quality_empty:
        print(f"  WARNING: {len(quality_empty)} items with empty content:")
        for idx, q in quality_empty[:5]:
            print(f"    #{idx}: {q}")
        if len(quality_empty) > 5:
            print(f"    ... and {len(quality_empty) - 5} more")
    if quality_fragments:
        print(f"  WARNING: {len(quality_fragments)} items with fragment content (<{FRAGMENT_THRESHOLD} chars):")
        for idx, q, length in quality_fragments[:5]:
            print(f"    #{idx} ({length} chars): {q}")
        if len(quality_fragments) > 5:
            print(f"    ... and {len(quality_fragments) - 5} more")
    if not quality_empty and not quality_fragments:
        print("  All items pass quality checks")
    print()

    # ── Step 7: Idempotency check ────────────────────────────────────
    if args.dry_run:
        print("[7/9] SKIPPED (dry run) — no idempotency check")
        print("[8/9] SKIPPED (dry run) — no embeddings generated")
        print("[9/9] SKIPPED (dry run) — no records stored")
    else:
        skip_existing = 0
        pairs_to_import = classified_pairs

        if not args.force:
            print("[7/9] Checking for existing records (idempotency)...")
            pairs_to_import = []
            for i, pair in enumerate(classified_pairs):
                if check_question_exists(pair["question_text"]):
                    skip_existing += 1
                    if skip_existing <= 5:
                        print(f"  SKIP (exists): {pair['question_text'][:80]}")
                else:
                    pairs_to_import.append(pair)
                if (i + 1) % 20 == 0:
                    print(f"  Checked {i + 1}/{len(classified_pairs)}...")

            if skip_existing > 5:
                print(f"  ... and {skip_existing - 5} more existing records skipped")
            print(f"  Existing: {skip_existing}, New: {len(pairs_to_import)}")

            if not pairs_to_import:
                print("  All records already exist. Use --force to re-import.")
        else:
            print("[7/9] SKIPPED (--force) — importing all records regardless")

        print()

        # ── Step 8: Embed ────────────────────────────────────────────
        embed_count = 0
        store_success = 0
        store_fail = 0

        if not pairs_to_import:
            print("[8/9] SKIPPED — no new records to embed")
            print("[9/9] SKIPPED — no new records to store")
        elif not args.skip_embed:
            print(f"[8/9] Generating embeddings for {len(pairs_to_import)} items...")
            try:
                from kb_pipeline.embed import build_embedding_text, generate_embedding
            except ImportError as e:
                print(f"  ERROR: Could not import embedding module: {e}")
                print("  Run with --skip-embed to store without vectors.")
                sys.exit(1)

            for i, pair in enumerate(pairs_to_import):
                try:
                    # Build richer embedding text: question + both answer fields
                    answer_text = pair.get("answer_standard", "")
                    if pair.get("answer_advanced"):
                        answer_text += "\n" + pair["answer_advanced"]

                    embed_text = build_embedding_text(
                        title=pair["question_text"][:120],
                        ai_summary=answer_text[:500],
                        content=answer_text,
                        content_type="q_a_pair",
                    )
                    embedding, tokens = generate_embedding(embed_text)
                    pair["_embedding"] = embedding
                    embed_count += 1
                    if (i + 1) % 10 == 0:
                        print(f"  Embedded {i + 1}/{len(pairs_to_import)}")
                except Exception as e:
                    print(f"  Embed error for pair #{i}: {e}")
                    pair["_embedding"] = None

            print(f"  Embeddings generated: {embed_count}/{len(pairs_to_import)}")
        else:
            print("[8/9] SKIPPED (--skip-embed) — no embeddings generated")
            for pair in pairs_to_import:
                pair["_embedding"] = None

        print()

        # ── Step 9: Store ────────────────────────────────────────────
        if pairs_to_import:
            print(f"[9/9] Storing {len(pairs_to_import)} items in Supabase...")
            try:
                from kb_pipeline.store import insert_content_item
            except ImportError as e:
                print(f"  ERROR: Could not import store module: {e}")
                sys.exit(1)

            for i, pair in enumerate(pairs_to_import):
                record = build_content_record(pair, batch_name)

                # Attach embedding if present
                if pair.get("_embedding"):
                    record["embedding"] = pair["_embedding"]

                success, id_or_error = insert_content_item(record)
                if success:
                    store_success += 1
                    if (i + 1) % 10 == 0:
                        print(f"  Stored {i + 1}/{len(pairs_to_import)}")
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
        if not args.force:
            print(f"  Already existing:     {skip_existing}")
        print(f"  New to import:        {len(pairs_to_import)}")
        print(f"  Embeddings:           {embed_count}")
        print(f"  Stored:               {store_success}")
        if store_fail:
            print(f"  Store failures:       {store_fail}")
    print(f"  Time:                 {elapsed:.1f}s ({elapsed/60:.1f}m)")
    print(f"  Batch:                {batch_name}")

    # ── Quality report ───────────────────────────────────────────────
    if quality_empty or quality_fragments:
        print()
        print("─" * 60)
        print("QUALITY REPORT")
        print("─" * 60)
        if quality_empty:
            print(f"  Empty content:    {len(quality_empty)} items (no answer text)")
        if quality_fragments:
            print(f"  Fragment content: {len(quality_fragments)} items (<{FRAGMENT_THRESHOLD} chars)")
        total_issues = len(quality_empty) + len(quality_fragments)
        total_items = len(classified_pairs)
        pct = (total_issues / total_items * 100) if total_items > 0 else 0
        print(f"  Quality issues:   {total_issues}/{total_items} ({pct:.1f}%)")
        print("  TIP: Review flagged items and expand content where needed.")


if __name__ == "__main__":
    main()
