#!/usr/bin/env python3
"""docs-seo-audit auditor (ID-9.18).

Scans the docs-site content tree for SEO issues across three severity tiers
(error / warning / info). EMITS findings only — it never rewrites. The
ASK-before-fixing guardrail is preserved from Warp: a human approves any
mass-rewrite via a follow-up workflow_dispatch with --fix (not implemented at
foundation).

Usage:
    python3 audit_seo.py --root docs-site/src/content/docs [--min-words 40]

Output: JSON {"issue_types": [...], "findings": [{path, issue, tier, detail}]}.
Exit code is 0 even with findings (this is advisory, not a build gate).

Spec: docs/specs/astro-starlight-docs-foundation/TECH.md §4.7; PRODUCT Inv-42.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

# 12 issue types across three severity tiers (>= the Inv-42 minimum of 11).
ISSUE_TIERS: dict[str, str] = {
    "missing-title": "error",
    "missing-description": "error",
    "duplicate-title": "error",
    "title-too-long": "warning",
    "title-too-short": "warning",
    "description-too-long": "warning",
    "description-too-short": "warning",
    "image-missing-alt": "warning",
    "non-descriptive-link-text": "warning",
    "multiple-h1": "info",
    "thin-content": "info",
    "missing-trailing-slash-internal-link": "info",
}

TITLE_MAX, TITLE_MIN = 60, 10
DESC_MAX, DESC_MIN = 160, 50
NON_DESCRIPTIVE = {"click here", "here", "read more", "this", "link"}

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)
IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
LINK_RE = re.compile(r"(?<!!)\[([^\]]+)\]\(([^)\s]+)[^)]*\)")
H1_RE = re.compile(r"^#[ \t]+\S", re.MULTILINE)


def _parse(text: str) -> tuple[dict, str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    fm: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip().strip("\"'")
    return fm, m.group(2)


def audit(root: Path, min_words: int) -> list[dict]:
    findings: list[dict] = []
    titles: dict[str, list[str]] = defaultdict(list)

    files = [p for p in root.rglob("*.md")] if root.exists() else []
    for path in files:
        rel = path.relative_to(root).as_posix()
        try:
            fm, body = _parse(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError):
            continue

        def add(issue: str, detail: str) -> None:
            findings.append(
                {"path": rel, "issue": issue, "tier": ISSUE_TIERS[issue], "detail": detail}
            )

        title = fm.get("title", "")
        if not title:
            add("missing-title", "no title front-matter field")
        else:
            titles[title].append(rel)
            if len(title) > TITLE_MAX:
                add("title-too-long", f"{len(title)} chars (> {TITLE_MAX})")
            elif len(title) < TITLE_MIN:
                add("title-too-short", f"{len(title)} chars (< {TITLE_MIN})")

        desc = fm.get("description", "")
        if not desc:
            add("missing-description", "no description front-matter field")
        elif len(desc) > DESC_MAX:
            add("description-too-long", f"{len(desc)} chars (> {DESC_MAX})")
        elif len(desc) < DESC_MIN:
            add("description-too-short", f"{len(desc)} chars (< {DESC_MIN})")

        for alt, src in IMG_RE.findall(body):
            if not alt.strip():
                add("image-missing-alt", f"image {src} has empty alt text")

        for label, _href in LINK_RE.findall(body):
            if label.strip().lower() in NON_DESCRIPTIVE:
                add("non-descriptive-link-text", f'link text "{label}" is non-descriptive')

        if len(H1_RE.findall(body)) > 1:
            add("multiple-h1", "more than one H1 heading in the body")

        if len(body.split()) < min_words:
            add("thin-content", f"body under {min_words} words")

        for _label, href in LINK_RE.findall(body):
            if href.startswith("/") and not href.endswith("/") and "#" not in href and "." not in href.split("/")[-1]:
                add(
                    "missing-trailing-slash-internal-link",
                    f"internal link {href} should end with a trailing slash",
                )

    for title, paths in titles.items():
        if len(paths) > 1:
            for rel in paths:
                findings.append(
                    {
                        "path": rel,
                        "issue": "duplicate-title",
                        "tier": ISSUE_TIERS["duplicate-title"],
                        "detail": f'title "{title}" shared by {len(paths)} pages',
                    }
                )

    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="docs-seo-audit")
    parser.add_argument("--root", default="docs-site/src/content/docs")
    parser.add_argument("--min-words", type=int, default=40)
    args = parser.parse_args(argv)

    findings = audit(Path(args.root).resolve(), args.min_words)
    json.dump(
        {"issue_types": ISSUE_TIERS, "findings": findings}, sys.stdout, indent=2
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
