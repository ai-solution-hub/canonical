"""Near-duplicate detection for Q&A pairs.

Uses only standard library modules: difflib.SequenceMatcher, re, hashlib.
No external dependencies required.

Usage:
    from scripts.dedup import find_near_duplicates, exact_dedup

    # Exact dedup: remove identical questions (by MD5 of normalised text)
    unique, removed = exact_dedup(pairs)

    # Near-duplicate detection: find similar questions above a threshold
    candidates = find_near_duplicates(unique, threshold=0.85)
"""

import hashlib
import os
import re
from difflib import SequenceMatcher

from dedup_normalise import normalise_title_for_dedup


def normalize_question(text: str) -> str:
    """Normalise question text for comparison.

    Lowercases, strips punctuation, collapses whitespace.
    Used for both exact dedup (MD5) and near-duplicate scoring.
    """
    text = text.lower().strip()
    # Remove common punctuation
    text = re.sub(r'[^\w\s]', '', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_core_question(text: str) -> str:
    """Strip known prefixes to extract the core question.

    Handles patterns like:
        "Alternative question: What is your approach..."
        "Additional: Describe your methodology..."
        "Follow-up question: How do you..."
    """
    # Strip "Alternative question:" and similar prefixes
    prefixes = [
        r'^alternative\s+question\s*:\s*',
        r'^additional\s+question\s*:\s*',
        r'^additional\s*:\s*',
        r'^follow[\-\s]*up\s+question\s*:\s*',
        r'^follow[\-\s]*up\s*:\s*',
        r'^supplementary\s+question\s*:\s*',
        r'^supplementary\s*:\s*',
        r'^related\s+question\s*:\s*',
        r'^bonus\s+question\s*:\s*',
    ]

    cleaned = text.strip()
    for prefix in prefixes:
        cleaned = re.sub(prefix, '', cleaned, flags=re.IGNORECASE)

    return cleaned.strip()


def question_hash(text: str) -> str:
    """Generate MD5 hash of normalised question text for exact dedup."""
    normalised = normalize_question(extract_core_question(text))
    return hashlib.md5(normalised.encode('utf-8')).hexdigest()


def title_dedup_hash(text: str) -> str:
    """Generate MD5 hash of title-normalised question text.

    Applies leading-article stripping + punctuation/whitespace
    normalisation via `normalise_title_for_dedup` so near-identical
    titles ("Are access levels granted according to the principle..."
    vs "...according to principle...") hash to the same key.

    Used by `dedup_across_files_by_title` to catch cross-file title
    overlaps that `question_hash` would miss. Reference:
    docs/specs/cross-system-dedup-spec.md §3 scope-add 4a.
    """
    cored = extract_core_question(text)
    normalised = normalise_title_for_dedup(cored)
    return hashlib.md5(normalised.encode('utf-8')).hexdigest()


def exact_dedup(pairs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Remove exact duplicate questions based on MD5 of normalised text.

    Args:
        pairs: List of Q&A dicts (must have 'question_text' key)

    Returns:
        (unique_pairs, removed_pairs) — both lists of dicts
    """
    seen_hashes: dict[str, int] = {}
    unique = []
    removed = []

    for pair in pairs:
        h = question_hash(pair["question_text"])
        if h in seen_hashes:
            removed.append(pair)
        else:
            seen_hashes[h] = len(unique)
            unique.append(pair)

    return unique, removed


def dedup_across_files_by_title(
    files_and_pairs: list[tuple[str, list[dict]]],
) -> tuple[list[dict], list[dict]]:
    """Deduplicate Q&A pairs across multiple files by normalised question title.

    Processes files in the given order; first occurrence of any normalised
    question title wins and later occurrences (in the same or subsequent
    files) are skipped. Uses the same hashing as `exact_dedup` so results
    are consistent if both are chained.

    Motivation: when both DRAFT and final .docx variants of the same Q&A
    library are staged together, overlapping question titles would otherwise
    reach the store step and create visible body-text duplication across
    `content_items`. Skipping earlier (with provenance logging) keeps the
    first-seen body and leaves a clear audit trail.

    Args:
        files_and_pairs: Ordered list of (source_file, pairs_list) tuples.

    Returns:
        (kept, skipped) — both lists of Q&A dicts. Each skipped pair is
        annotated in-place with `_skipped_because` = {
            "first_seen_file": str,        # basename of the earlier file
            "first_seen_row": int,         # row_index from the earlier file
            "first_seen_question": str,    # raw question_text from earlier
        }.
    """
    kept: list[dict] = []
    skipped: list[dict] = []
    seen: dict[str, tuple[str, int, str]] = {}

    for source_file, pairs in files_and_pairs:
        basename = os.path.basename(source_file)
        for pair in pairs:
            # S183 WP2 — title_dedup_hash strips leading articles and
            # trailing punctuation so "Are access levels granted
            # according to the principle of least privilege?" collides
            # with "...according to principle of least privilege?".
            # question_hash alone missed this during S182 re-ingestion.
            h = title_dedup_hash(pair["question_text"])
            if h in seen:
                first_file, first_row, first_q = seen[h]
                pair["_skipped_because"] = {
                    "first_seen_file": first_file,
                    "first_seen_row": first_row,
                    "first_seen_question": first_q,
                }
                skipped.append(pair)
                continue
            seen[h] = (basename, pair.get("row_index", -1), pair["question_text"])
            kept.append(pair)

    return kept, skipped


def similarity_score(text_a: str, text_b: str) -> float:
    """Compute similarity between two question texts using SequenceMatcher.

    Both texts are normalised before comparison.
    Returns a float between 0.0 (no similarity) and 1.0 (identical).
    """
    norm_a = normalize_question(extract_core_question(text_a))
    norm_b = normalize_question(extract_core_question(text_b))
    return SequenceMatcher(None, norm_a, norm_b).ratio()


def find_near_duplicates(
    pairs: list[dict],
    threshold: float = 0.85,
) -> list[tuple[int, int, float, str, str]]:
    """Find near-duplicate Q&A pairs by pairwise comparison.

    Compares all pairs against each other using SequenceMatcher on
    normalised question text.

    Args:
        pairs: List of Q&A dicts (must have 'question_text' key)
        threshold: Minimum similarity ratio to flag as near-duplicate (0.0-1.0)

    Returns:
        List of tuples: (index_a, index_b, similarity, question_a, question_b)
        sorted by similarity descending.
    """
    candidates = []
    n = len(pairs)

    for i in range(n):
        q_i = pairs[i]["question_text"]
        for j in range(i + 1, n):
            q_j = pairs[j]["question_text"]
            score = similarity_score(q_i, q_j)
            if score >= threshold:
                candidates.append((i, j, score, q_i, q_j))

    # Sort by similarity descending
    candidates.sort(key=lambda x: x[2], reverse=True)
    return candidates


# ── CLI entry point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 scripts/dedup.py <pairs.json> [--threshold 0.85]")
        print("  Input: JSON file with list of dicts, each having 'question_text'")
        sys.exit(1)

    input_path = sys.argv[1]
    threshold = 0.85
    if "--threshold" in sys.argv:
        idx = sys.argv.index("--threshold")
        if idx + 1 < len(sys.argv):
            threshold = float(sys.argv[idx + 1])

    with open(input_path, "r") as f:
        pairs = json.load(f)

    print(f"Loaded {len(pairs)} pairs from {input_path}")

    # Exact dedup
    unique, removed = exact_dedup(pairs)
    print(f"Exact duplicates removed: {len(removed)}")
    print(f"Unique pairs: {len(unique)}")

    # Near-duplicate detection
    candidates = find_near_duplicates(unique, threshold=threshold)
    print(f"\nNear-duplicates found (threshold={threshold}): {len(candidates)}")
    for idx_a, idx_b, score, q_a, q_b in candidates[:10]:
        print(f"\n  [{idx_a}] vs [{idx_b}] — similarity: {score:.3f}")
        print(f"    A: {q_a[:100]}")
        print(f"    B: {q_b[:100]}")
    if len(candidates) > 10:
        print(f"\n  ... and {len(candidates) - 10} more candidates")
