#!/usr/bin/env python3
"""Evaluation script for the holder-disambiguation prompt rule (S192 WP1).

Fetches content items linked to `holds` relationships from Supabase, re-runs
classification with the updated prompt (always dry-run; NO DB writes), and
compares new relationships against existing entity_relationships rows to report
TP/FP/FN.

Usage:
    python3 scripts/kb_pipeline/eval_holder_rule.py
    python3 scripts/kb_pipeline/eval_holder_rule.py --limit 5
    python3 scripts/kb_pipeline/eval_holder_rule.py --output report.json

NOTE: When running from Claude Code, invoke with dangerouslyDisableSandbox: true
because the Anthropic SDK's httpx transport hangs behind the sandbox SOCKS proxy.

Requires ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY in .env.
"""

import argparse
import json
import logging
import os
import sys

# Ensure the project root is on sys.path so kb_pipeline is importable
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))

from kb_pipeline.config import (  # noqa: E402
    CLASSIFICATION_MODEL,
)
from kb_pipeline.classify import (  # noqa: E402
    classify,
)
from kb_pipeline.store import _request  # noqa: E402

logger = logging.getLogger(__name__)

# Client organisation name (lowercased) for holder attribution comparison.
# Matches BRANDING.organisationName.toLowerCase() in production TS code.
CLIENT_ORG_LOWER = "Example Client Ltd"


# ------------------------------------------
# Data fetching
# ------------------------------------------


def fetch_holds_relationships():
    """Fetch all entity_relationships with relationship_type = 'holds'.

    Returns list of dicts with id, source_entity, target_entity,
    source_item_id, confidence.
    """
    path = (
        "entity_relationships"
        "?relationship_type=eq.holds"
        "&select=id,source_entity,target_entity,source_item_id,confidence"
        "&order=source_entity.asc"
    )
    status, data = _request("GET", path)
    if status not in (200, 206):
        raise RuntimeError(
            f"Failed to fetch holds relationships: {status} {data}"
        )
    return data or []


def fetch_content_item(item_id):
    """Fetch a single content_item by ID.

    Returns dict with id, title, content, content_type, platform, author fields,
    or None if not found.
    """
    path = (
        f"content_items?id=eq.{item_id}"
        "&select=id,title,content,content_type,platform,author_name"
    )
    status, data = _request("GET", path)
    if status not in (200, 206) or not data:
        return None
    return data[0]


# ------------------------------------------
# Diff logic
# ------------------------------------------


def normalise_rel(rel):
    """Normalise a relationship dict to a comparable tuple.

    Returns (source_lower, relationship_type, target_lower).
    """
    source = rel.get("source", rel.get("source_entity", "")).lower().strip()
    rel_type = rel.get("relationship_type", rel.get("relationship", "")).lower().strip()
    target = rel.get("target", rel.get("target_entity", "")).lower().strip()
    return (source, rel_type, target)


def compute_diff(existing_rels, new_rels, client_org=CLIENT_ORG_LOWER):
    """Compare existing and new relationship sets for a single content item.

    Both inputs are lists of relationship dicts. existing_rels come from
    entity_relationships (keys: source_entity, relationship_type, target_entity).
    new_rels come from classification output (keys: source, relationship_type,
    target).

    Returns a dict with:
        - unchanged: list of rels present in both (same source+type+target)
        - removed: list of rels in existing but not new
        - added: list of rels in new but not existing
        - changed_holder: list of dicts with before/after where source changed
          for the same target+type (the core metric for this evaluation)
        - precision_regressions: rels where source changed FROM client_org TO
          a third party (potential false supplier attribution)
    """
    existing_set = {normalise_rel(r) for r in existing_rels}
    new_set = {normalise_rel(r) for r in new_rels}

    unchanged = existing_set & new_set
    removed = existing_set - new_set
    added = new_set - existing_set

    # Detect holder changes: same (type, target) pair but different source
    existing_by_key = {}
    for s, t, tgt in existing_set:
        key = (t, tgt)  # (relationship_type, target)
        existing_by_key.setdefault(key, set()).add(s)

    new_by_key = {}
    for s, t, tgt in new_set:
        key = (t, tgt)
        new_by_key.setdefault(key, set()).add(s)

    changed_holder = []
    precision_regressions = []

    for key in set(existing_by_key.keys()) | set(new_by_key.keys()):
        old_sources = existing_by_key.get(key, set())
        new_sources = new_by_key.get(key, set())

        if old_sources != new_sources:
            rel_type, target = key
            for old_src in old_sources:
                if old_src not in new_sources:
                    # Source changed -- find what it changed to
                    new_src_candidates = new_sources - old_sources
                    for new_src in new_src_candidates:
                        change = {
                            "target": target,
                            "relationship_type": rel_type,
                            "before_source": old_src,
                            "after_source": new_src,
                        }
                        changed_holder.append(change)

                        # Precision regression: client_org -> third party
                        if old_src == client_org and new_src != client_org:
                            precision_regressions.append(change)

    return {
        "unchanged": [
            {"source": s, "type": t, "target": tgt}
            for s, t, tgt in unchanged
        ],
        "removed": [
            {"source": s, "type": t, "target": tgt}
            for s, t, tgt in removed
        ],
        "added": [
            {"source": s, "type": t, "target": tgt}
            for s, t, tgt in added
        ],
        "changed_holder": changed_holder,
        "precision_regressions": precision_regressions,
    }


# ------------------------------------------
# Main logic
# ------------------------------------------


def run_evaluation(limit=None, dry_run=True):
    """Run the holder-rule evaluation against the production corpus.

    Steps:
    1. Fetch all `holds` relationships from entity_relationships.
    2. Group by source_item_id to identify content items needing
       re-classification.
    3. For each content item, re-run classification with the updated prompt.
    4. Compare new relationships against existing ones.
    5. Aggregate results into a report.

    Args:
        limit: Maximum number of content items to process (None = all).
        dry_run: If True (default), never write to DB.

    Returns:
        Report dict with aggregate metrics and per-item diffs.
    """
    if not dry_run:
        raise ValueError(
            "This script is dry-run only. "
            "DB writes are not supported -- use the pipeline for that."
        )

    logger.info("Fetching holds relationships from entity_relationships...")
    all_holds = fetch_holds_relationships()
    logger.info("Found %d holds relationships total.", len(all_holds))

    # Group by source_item_id
    items_to_rels = {}
    for rel in all_holds:
        item_id = rel.get("source_item_id")
        if item_id:
            items_to_rels.setdefault(item_id, []).append(rel)

    item_ids = list(items_to_rels.keys())
    logger.info(
        "Found %d unique content items with holds relationships.",
        len(item_ids),
    )

    if limit:
        item_ids = item_ids[:limit]
        logger.info("Limiting to first %d items.", limit)

    # Aggregate counters
    total_evaluated = 0
    total_unchanged = 0
    total_changed_holder = 0
    total_precision_regressions = 0
    total_recall_new_supplier = 0
    positive_controls_changed = []
    per_item_diffs = []

    # Known positive controls (example-datacentre false positives from spec section 4.3)
    positive_control_targets = frozenset([
        "iso 27001", "iso 9001", "iso 14001",
    ])

    for i, item_id in enumerate(item_ids):
        logger.info(
            "Processing item %d/%d: %s", i + 1, len(item_ids), item_id
        )

        content_item = fetch_content_item(item_id)
        if not content_item:
            logger.warning("Content item %s not found, skipping.", item_id)
            continue

        # Re-classify with updated prompt
        try:
            result = classify(
                title=content_item.get("title", ""),
                content=content_item.get("content", ""),
                content_type=content_item.get("content_type", "article"),
                platform=content_item.get("platform", "web"),
                author_name=content_item.get("author_name", ""),
            )
        except Exception as e:
            logger.error(
                "Classification failed for item %s: %s", item_id, e
            )
            per_item_diffs.append({
                "source_item_id": item_id,
                "title": content_item.get("title", ""),
                "error": str(e),
            })
            continue

        # Extract holds relationships from new classification
        new_holds = [
            r for r in result.relationships
            if r.get("relationship_type") == "holds"
        ]

        # Compare against existing
        existing_holds = items_to_rels[item_id]
        diff = compute_diff(existing_holds, new_holds)

        total_evaluated += 1
        total_unchanged += len(diff["unchanged"])
        total_changed_holder += len(diff["changed_holder"])
        total_precision_regressions += len(diff["precision_regressions"])

        # Check for new supplier detections
        for change in diff["changed_holder"]:
            if (
                change["before_source"] == CLIENT_ORG_LOWER
                and change["after_source"] != CLIENT_ORG_LOWER
            ):
                total_recall_new_supplier += 1

                # Check positive controls
                if change["target"] in positive_control_targets:
                    positive_controls_changed.append(change)

        item_diff = {
            "source_item_id": item_id,
            "title": content_item.get("title", ""),
            "before_rels": [
                {
                    "source_entity": r["source_entity"],
                    "target_entity": r["target_entity"],
                    "relationship_type": "holds",
                }
                for r in existing_holds
            ],
            "after_rels": [
                {
                    "source": r.get("source", ""),
                    "target": r.get("target", ""),
                    "relationship_type": r.get("relationship_type", ""),
                }
                for r in new_holds
            ],
            "diff": {
                "unchanged_count": len(diff["unchanged"]),
                "removed_count": len(diff["removed"]),
                "added_count": len(diff["added"]),
                "changed_holder": diff["changed_holder"],
                "precision_regressions": diff["precision_regressions"],
            },
        }
        per_item_diffs.append(item_diff)

        logger.info(
            "  -> %d unchanged, %d removed, %d added, "
            "%d holder changes, %d regressions",
            len(diff["unchanged"]),
            len(diff["removed"]),
            len(diff["added"]),
            len(diff["changed_holder"]),
            len(diff["precision_regressions"]),
        )

    # Precision regressions exclude the known example-datacentre positive controls
    # (spec ss4.3 lists iso 27001, iso 9001, iso 14001 as EXPECTED flips).
    # gross = raw count of client_org -> non_client_org source changes.
    # net   = gross minus positive-control flips = TRUE precision regressions
    #         (spec ss4.5 accept-threshold: 0).
    net_precision_regressions = (
        total_precision_regressions - len(positive_controls_changed)
    )

    # Build report
    report = {
        "eval_type": "holder_disambiguation_rule",
        "model": CLASSIFICATION_MODEL,
        "client_org": CLIENT_ORG_LOWER,
        "dry_run": dry_run,
        "total_holds_relationships": len(all_holds),
        "unique_content_items": len(items_to_rels),
        "items_evaluated": total_evaluated,
        "limit_applied": limit,
        "positive_controls_changed": [
            {
                "target": c["target"],
                "before_source": c["before_source"],
                "after_source": c["after_source"],
            }
            for c in positive_controls_changed
        ],
        "positive_controls_expected": 3,
        "positive_controls_found": len(positive_controls_changed),
        "precision_regressions": net_precision_regressions,
        "gross_source_changes_from_client": total_precision_regressions,
        "recall_new_supplier_detections": total_recall_new_supplier,
        "total_unchanged": total_unchanged,
        "total_changed_holder": total_changed_holder,
        "per_item_diff": per_item_diffs,
    }

    return report


# ------------------------------------------
# CLI
# ------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Run the holder-disambiguation prompt rule evaluation against "
            "production cert mentions. Always dry-run -- no DB writes."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of content items to process.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Path to write JSON report (default: stdout).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Enable verbose logging.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    report = run_evaluation(limit=args.limit, dry_run=True)

    report_json = json.dumps(report, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(report_json)
        logger.info("Report written to %s", args.output)
    else:
        print(report_json)

    # Summary to stderr
    sys.stderr.write(
        f"\n--- Holder Rule Evaluation Summary ---\n"
        f"Items processed: {report['items_evaluated']}\n"
        f"Positive controls changed: "
        f"{report['positive_controls_found']}"
        f"/{report['positive_controls_expected']}\n"
        f"Precision regressions (net, spec threshold=0): "
        f"{report['precision_regressions']}\n"
        f"Gross source-changes from client: "
        f"{report['gross_source_changes_from_client']} "
        f"(includes {report['positive_controls_found']} expected positive-control flips)\n"
        f"New supplier detections: "
        f"{report['recall_new_supplier_detections']}\n"
        f"Total holder changes: {report['total_changed_holder']}\n"
        f"Total unchanged: {report['total_unchanged']}\n"
        f"---\n"
    )


if __name__ == "__main__":
    main()
