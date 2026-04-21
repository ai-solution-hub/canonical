#!/usr/bin/env python3
"""Ingest Stage 2 client markdown into new Supabase project.

Parses the 4 client-provided markdown files from docs/client-documentation/
stage2-markdown/ into granular content_items, matching Stage 1 Q&A
granularity where applicable:

  * Advanced_Audits_Bid_Library_v5.md   → q_a_pair per YAML-frontmatter entry
  * LMS_Bid_Library_v2.2.md              → q_a_pair per `#### CODE-NNN:` entry
  * Website_Bid_Library_v4_2.md          → q_a_pair per `#### Question` entry
  * example-client-Bid-Library-2026-v4_4.md        → article per `## Section` (reference)

All items are tagged with batch_tag='client-new-markdown-2026' and flow through
keyword classification → embedding → DB insert → entity extraction, reusing
logic from import_bid_library.py.

Usage:
    python3 scripts/ingest_stage2_markdown.py [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv

load_dotenv(".env.local")
load_dotenv(".env", override=False)

from supabase import create_client

from keyword_classifier import classify_pairs
from kb_pipeline.embed import build_embedding_text, generate_embedding
from kb_pipeline.classify import (
    classify as ai_classify,
    store_entities,
    store_relationships,
    load_entity_aliases,
)
from import_bid_library import extract_keywords, truncate_at_word_boundary

BATCH_TAG = "client-new-markdown-2026"
STAGE2_DIR = Path("docs/client-documentation/stage2-markdown")


@dataclass
class Entry:
    source_id: str
    source_file: str
    title: str
    question: str
    answer: str
    topics: list[str] = field(default_factory=list)
    content_type: str = "q_a_pair"  # or 'article'


# ───────────────────────────── parsers ──────────────────────────────


def _clean_body(body: str) -> str:
    """Strip trailing --- delimiter artefacts and collapse blank lines."""
    body = re.sub(r"\n---\s*$", "", body.strip())
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def parse_advanced_audits(md: str) -> list[Entry]:
    """YAML frontmatter: ``---\\nid: AUD-NNN\\nquestion: ...\\n---`` then body."""
    entries: list[Entry] = []
    # Match each entry: fence, fields, fence, body until next fence-with-id or EOF.
    pattern = re.compile(
        r"---\s*\n"
        r"id:\s*(AUD-\d+)\s*\n"
        r"question:\s*([^\n]+)\n"
        r"(?:products:[^\n]*\n)?"
        r"(?:modules:[^\n]*\n)?"
        r"topics:\s*\[([^\]]*)\]\s*\n"
        r"---\s*\n"
        r"(.*?)"
        r"(?=\n---\s*\nid:\s*AUD-|\Z)",
        re.DOTALL,
    )
    for m in pattern.finditer(md):
        source_id, question, topics_raw, body = m.groups()
        topics = [t.strip() for t in topics_raw.split(",") if t.strip()]
        entries.append(
            Entry(
                source_id=source_id,
                source_file="Advanced_Audits_v5",
                title=question.strip()[:120],
                question=question.strip(),
                answer=_clean_body(body),
                topics=topics,
                content_type="q_a_pair",
            )
        )
    return entries


def parse_lms(md: str) -> list[Entry]:
    """``#### CODE-NNN: Question\\n**ID**: ... | **Source**: ...\\n\\n**Topics**: ...\\nbody``."""
    entries: list[Entry] = []
    pattern = re.compile(
        r"^####\s+([A-Z]+-\d+):\s*(.+?)\n"
        r"\*\*ID\*\*:\s*[A-Z]+-\d+[^\n]*\n"
        r"(?:[^\n]*\n)?"
        r"\n?"
        r"(?:\*\*Topics\*\*:\s*([^\n]+)\n)?"
        r"(.*?)"
        r"(?=\n####\s+[A-Z]+-\d+:|\n### |\n## [0-9]|\n# [A-Z]|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(md):
        source_id, question, topics_raw, body = m.groups()
        topics = [t.strip() for t in (topics_raw or "").split(",") if t.strip()]
        entries.append(
            Entry(
                source_id=source_id,
                source_file="LMS_v2.2",
                title=question.strip()[:120],
                question=question.strip(),
                answer=_clean_body(body),
                topics=topics,
                content_type="q_a_pair",
            )
        )
    return entries


def parse_website(md: str) -> list[Entry]:
    """``#### Question\\n\\n**ID:** CODE-NNN\\n\\nbody``."""
    entries: list[Entry] = []
    pattern = re.compile(
        r"^####\s+(.+?)\n"
        r"\n?"
        r"\*\*ID:\*\*\s*([A-Z]+-\d+(?:\s*\+\s*[A-Z]+-\d+)?)[^\n]*\n"
        r"(.*?)"
        r"(?=\n####\s+|\n### |\n## [0-9]|\n# [A-Z]|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    for m in pattern.finditer(md):
        question, source_id, body = m.groups()
        entries.append(
            Entry(
                source_id=source_id.strip(),
                source_file="Website_v4_2",
                title=question.strip()[:120],
                question=question.strip(),
                answer=_clean_body(body),
                topics=[],
                content_type="q_a_pair",
            )
        )
    return entries


def parse_example-client_sections(md: str) -> list[Entry]:
    """``## Section Title\\nbody`` — reference article per ## section, skipping index-only sections."""
    entries: list[Entry] = []
    # The example-client file has an initial BID RESPONSE TOPIC INDEX with ### subsections
    # and then later ## reference sections. We split on level-2 headings and
    # filter to sections with substantive body (>= 200 chars excluding bullets).
    sections = re.split(r"\n## ", md)
    # Skip index / navigation section titles that are meta rather than reference.
    INDEX_TITLES = {
        "BID RESPONSE TOPIC INDEX",
        "DEDUP ANALYSIS",
        "GAP ANALYSIS",
        "GAP ANALYSIS — What's Missing?",
        "ENTRIES TO MOVE TO COMPANY-WIDE LIBRARY",
        "RESTRUCTURING SUMMARY",
    }
    for sec in sections[1:]:  # skip intro before first ##
        lines = sec.split("\n", 1)
        if len(lines) < 2:
            continue
        title = lines[0].strip()
        if title in INDEX_TITLES or title.lower().startswith(("bid response topic", "dedup", "gap analysis", "entries to move", "restructuring")):
            continue
        body = _clean_body(lines[1])
        # Skip if body is mostly a bullet-list index (index entries are short,
        # heavy on bullets, light on prose).
        plain = re.sub(r"^[-*]\s+.*$", "", body, flags=re.MULTILINE).strip()
        if len(plain) < 200:
            continue
        # Derive a source_id from Merged From / From / section title.
        src_m = re.search(r"\*\*(?:Merged From|From)\*\*:\s*([^\n]+)", body)
        if src_m:
            source_id = "example-client-" + re.sub(r"[^A-Z0-9]+", "-", src_m.group(1).upper())[:60].strip("-")
        else:
            source_id = "example-client-" + re.sub(r"[^A-Za-z0-9]+", "-", title.upper())[:60].strip("-")
        entries.append(
            Entry(
                source_id=source_id,
                source_file="example-client_v4_4",
                title=title[:120],
                question="",
                answer=body,
                topics=[],
                content_type="article",
            )
        )
    return entries


# ───────────────────────────── pipeline ─────────────────────────────


def entries_to_pairs(entries: list[Entry]) -> list[dict]:
    """Convert Entry dataclasses to the 'pair' dict shape used by keyword_classifier + import_bid_library."""
    pairs = []
    for e in entries:
        pairs.append(
            {
                "question_text": e.question or e.title,
                "answer_standard": e.answer,
                "answer_advanced": "",
                "source_file": e.source_file,
                "section_name": e.source_id,
                "table_index": 0,
                "row_index": 0,
                "has_tracked_changes": False,
                "_batch_tag": BATCH_TAG,
                "_content_type": e.content_type,
                "_source_id": e.source_id,
                "_topics": e.topics,
            }
        )
    return pairs


def build_record(pair: dict) -> dict:
    """Build a content_items insert row for both q_a_pair and article types."""
    answer_text = pair.get("answer_standard") or ""
    title_raw = pair["question_text"]
    title = truncate_at_word_boundary(title_raw, 120)

    content_type = pair.get("_content_type", "q_a_pair")
    if content_type == "q_a_pair":
        content = f"Q: {pair['question_text']}\n\n{answer_text}"
    else:  # article — no Q prefix
        content = answer_text

    summary = truncate_at_word_boundary(answer_text, 200)
    keywords = extract_keywords(
        title_raw,
        answer_text,
        pair.get("primary_domain") or None,
        pair.get("primary_subtopic") or None,
    )

    record = {
        "title": title,
        "content": content,
        "content_type": content_type,
        "platform": "extraction",
        "source_url": "",
        "source_domain": "",
        # Coerce empty-string to NULL — see keyword_classifier.py §S182 fix
        # and cutover report §8.2.
        "primary_domain": pair.get("primary_domain") or None,
        "primary_subtopic": pair.get("primary_subtopic") or None,
        "secondary_domain": pair.get("secondary_domain") or None,
        "secondary_subtopic": pair.get("secondary_subtopic") or None,
        "classification_confidence": pair.get("classification_confidence", 0.0),
        "classified_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "ai_keywords": [k for k in keywords if k],
        "source_file": pair.get("source_file"),
        "user_tags": [BATCH_TAG],
        "metadata": {
            "stage2_source_id": pair.get("_source_id", ""),
            "stage2_topics": pair.get("_topics", []),
            "section_name": pair.get("section_name", ""),
            "import_batch": BATCH_TAG,
        },
    }

    if content_type == "q_a_pair":
        record["answer_standard"] = answer_text or None
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Parse + classify, do not write")
    parser.add_argument("--limit", type=int, default=0, help="Limit items processed (0 = all)")
    parser.add_argument(
        "--skip-entities",
        action="store_true",
        help="Skip AI entity extraction (faster dry-run)",
    )
    parser.add_argument(
        "--only",
        choices=["aud", "lms", "website", "example-client"],
        help="Process only one file (debug)",
    )
    args = parser.parse_args()

    files = {
        "aud": (STAGE2_DIR / "Advanced_Audits_Bid_Library_v5.md", parse_advanced_audits),
        "lms": (STAGE2_DIR / "LMS_Bid_Library_v2.2.md", parse_lms),
        "website": (STAGE2_DIR / "Website_Bid_Library_v4_2.md", parse_website),
        "example-client": (STAGE2_DIR / "example-client-Bid-Library-2026-v4_4.md", parse_example-client_sections),
    }

    if args.only:
        files = {args.only: files[args.only]}

    all_entries: list[Entry] = []
    for key, (path, parser_fn) in files.items():
        if not path.exists():
            print(f"  MISSING: {path}", flush=True)
            continue
        md = path.read_text()
        entries = parser_fn(md)
        print(f"  {key:<8} {path.name:<42} parsed {len(entries)} entries", flush=True)
        all_entries.extend(entries)

    print(f"\nTotal parsed entries: {len(all_entries)}", flush=True)
    if args.limit > 0:
        all_entries = all_entries[: args.limit]
        print(f"Limited to {len(all_entries)} entries", flush=True)

    if not all_entries:
        return 0

    # Build pairs, run keyword classifier (lowercase canonical domains).
    pairs = entries_to_pairs(all_entries)
    print("\nClassifying...", flush=True)
    classified = classify_pairs(pairs)

    # Report classification coverage.
    cls_counts: dict[str, int] = {}
    for p in classified:
        d = p.get("primary_domain") or "(unclassified)"
        cls_counts[d] = cls_counts.get(d, 0) + 1
    print("Classification distribution:")
    for d, n in sorted(cls_counts.items(), key=lambda x: -x[1]):
        print(f"  {d:<32} {n}")

    if args.dry_run:
        print("\n[dry-run] Stopping before DB writes.")
        return 0

    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ["SUPABASE_SECRET_KEY"]
    sb = create_client(url, key)

    print(f"\nIngesting into {url} with batch_tag='{BATCH_TAG}'...", flush=True)
    stored_ids: list[tuple[dict, str]] = []
    insert_errors = 0
    t0 = time.time()
    for i, pair in enumerate(classified):
        record = build_record(pair)

        # Embedding.
        try:
            embed_text = build_embedding_text(
                title=record["title"],
                summary=record["summary"] or "",
                content=record["content"],
                content_type=record["content_type"],
            )
            embedding, _tokens = generate_embedding(embed_text)
            record["embedding"] = embedding
        except Exception as e:  # noqa: BLE001
            print(f"  EMBED ERROR entry #{i}: {e}", flush=True)
            record["embedding"] = None

        try:
            resp = sb.table("content_items").insert(record).execute()
            item_id = resp.data[0]["id"]
            stored_ids.append((pair, item_id))
        except Exception as e:  # noqa: BLE001
            insert_errors += 1
            print(f"  INSERT ERROR entry #{i} ({pair.get('_source_id')}): {e}", flush=True)
            continue

        if (i + 1) % 10 == 0:
            rate = (i + 1) / (time.time() - t0)
            eta = (len(classified) - i - 1) / rate if rate > 0 else 0
            print(
                f"  {i + 1}/{len(classified)} stored  rate={rate:.2f}/s  eta={eta:.0f}s",
                flush=True,
            )

    print(f"\nStored {len(stored_ids)}/{len(classified)} items, {insert_errors} insert errors.")

    # Entity extraction pass.
    if not args.skip_entities and stored_ids:
        print("\nRunning entity extraction...", flush=True)
        load_entity_aliases()
        entity_count = 0
        rel_count = 0
        ent_errors = 0
        for i, (pair, item_id) in enumerate(stored_ids):
            try:
                cls_result = ai_classify(
                    title=pair["question_text"] or "",
                    content=pair.get("answer_standard") or "",
                    content_type=pair.get("_content_type", "q_a_pair"),
                    platform="extraction",
                )
                if cls_result.entities:
                    n, _ = store_entities(item_id, cls_result.entities)
                    entity_count += n
                if cls_result.relationships:
                    n, _ = store_relationships(item_id, cls_result.relationships)
                    rel_count += n
            except Exception as e:  # noqa: BLE001
                ent_errors += 1
                print(f"  ENTITY ERROR {item_id}: {e}", flush=True)
            if (i + 1) % 10 == 0:
                print(
                    f"  entities {i + 1}/{len(stored_ids)}  stored={entity_count}  rels={rel_count}",
                    flush=True,
                )
        print(
            f"\nEntities: {entity_count} stored, {rel_count} relationships, {ent_errors} errors",
            flush=True,
        )

    print("\nDONE.")
    return 0 if insert_errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
