#!/usr/bin/env python3
"""check-for-broken-links link-walker (ID-9.17).

Walks the docs-site content tree and classifies every internal markdown link
into one of five error types. External links are checked only when
--check-external is passed (HTTP 4xx / timeout). Findings print as JSON; with
--gh-pr-comment the caller posts them on the PR (replaces Warp's
--slack-notify).

Usage:
    python3 check_links.py --root docs-site/src/content/docs
                           [--spaces a,b,c] [--check-external] [--timeout 10]
                           [--gh-pr-comment]

Five error types (Inv-41):
    file-not-found        target path does not exist
    case-mismatch         target exists only under a different case
    missing-mdx-ext       directory-style link missing its .md/.mdx target
    cross-space-relative  relative link crossing IA spaces (should be absolute)
    external-error        external URL returns 4xx or times out

Exit code: 1 when findings exist (linter semantics), 0 when clean.

Spec: docs/specs/id-9-astro-starlight-docs-foundation/TECH.md §4.6; PRODUCT Inv-41.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ERROR_TYPES = (
    "file-not-found",
    "case-mismatch",
    "missing-mdx-ext",
    "cross-space-relative",
    "external-error",
)

DEFAULT_SPACES = (
    "product-functionality",
    "ontology",
    "reference",
    "runbooks",
    "decisions",
)

# [label](href) — ignore image embeds' surrounding text; capture href up to
# the first whitespace or closing paren.
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


def _is_external(href: str) -> bool:
    return href.startswith(("http://", "https://", "mailto:", "tel:"))


def _space_of(rel_path: Path, spaces: tuple[str, ...]) -> str | None:
    parts = rel_path.parts
    return parts[0] if parts and parts[0] in spaces else None


def _resolve_case(target: Path) -> str | None:
    """Return 'ok' if target exists with the exact case, 'case' if only the
    case differs, else None.

    Compares against the real directory entries rather than calling
    ``target.exists()`` — on a case-insensitive host filesystem (macOS APFS,
    Windows) ``exists()`` returns True for a wrong-case path, which would mask
    the very case-mismatch this guard exists to catch in case-sensitive
    production (Astro on Linux)."""
    parent = target.parent
    if not parent.exists():
        return None
    names = {p.name for p in parent.iterdir()}
    if target.name in names:
        return "ok"
    lower = target.name.lower()
    if any(n.lower() == lower for n in names):
        return "case"
    return None


def check_file(
    md_file: Path, root: Path, spaces: tuple[str, ...]
) -> list[dict]:
    findings: list[dict] = []
    rel = md_file.relative_to(root)
    src_space = _space_of(rel, spaces)
    try:
        lines = md_file.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return findings

    for lineno, line in enumerate(lines, start=1):
        for m in LINK_RE.finditer(line):
            href = m.group(1)
            if _is_external(href) or href.startswith("#"):
                continue

            base = href.split("#", 1)[0].split("?", 1)[0]
            if not base:
                continue

            # Cross-space relative path (Inv-6): a relative link that climbs out
            # of the current space into another known space.
            if base.startswith("../"):
                segs = [s for s in base.split("/") if s and s != ".."]
                if segs and segs[0] in spaces and segs[0] != src_space:
                    findings.append(
                        {
                            "path": rel.as_posix(),
                            "line": lineno,
                            "href": href,
                            "error_type": "cross-space-relative",
                        }
                    )
                    continue

            if base.startswith("/"):
                # Absolute site path — Starlight serves /space/slug/ from
                # space/slug.md. Map back to a source file under root.
                target = root / base.strip("/")
            else:
                target = (md_file.parent / base).resolve()

            # Directory-style or extensionless link: must resolve to a .md/.mdx.
            if base.endswith("/") or (target.suffix == "" and not target.is_file()):
                candidate_md = Path(f"{str(target).rstrip('/')}.md")
                candidate_index = target / "index.md"
                if not candidate_md.is_file() and not candidate_index.is_file():
                    findings.append(
                        {
                            "path": rel.as_posix(),
                            "line": lineno,
                            "href": href,
                            "error_type": "missing-mdx-ext",
                        }
                    )
                continue

            status = _resolve_case(target)
            if status == "case":
                findings.append(
                    {
                        "path": rel.as_posix(),
                        "line": lineno,
                        "href": href,
                        "error_type": "case-mismatch",
                    }
                )
            elif status is None:
                findings.append(
                    {
                        "path": rel.as_posix(),
                        "line": lineno,
                        "href": href,
                        "error_type": "file-not-found",
                    }
                )
    return findings


def check_external(md_files: list[Path], root: Path, timeout: float) -> list[dict]:
    import urllib.error
    import urllib.request

    findings: list[dict] = []
    seen: dict[str, bool] = {}
    for md_file in md_files:
        rel = md_file.relative_to(root)
        try:
            lines = md_file.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(lines, start=1):
            for m in LINK_RE.finditer(line):
                href = m.group(1)
                if not href.startswith(("http://", "https://")):
                    continue
                if href not in seen:
                    ok = True
                    try:
                        req = urllib.request.Request(href, method="HEAD")
                        urllib.request.urlopen(req, timeout=timeout)
                    except urllib.error.HTTPError as exc:
                        ok = 400 > exc.code or exc.code >= 500
                    except Exception:
                        ok = False
                    seen[href] = ok
                if not seen[href]:
                    findings.append(
                        {
                            "path": rel.as_posix(),
                            "line": lineno,
                            "href": href,
                            "error_type": "external-error",
                        }
                    )
    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="check-for-broken-links walker")
    parser.add_argument("--root", default="docs-site/src/content/docs")
    parser.add_argument("--spaces", default=",".join(DEFAULT_SPACES))
    parser.add_argument("--check-external", action="store_true")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--gh-pr-comment",
        action="store_true",
        help="Caller posts findings on the PR (replaces Warp --slack-notify).",
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    spaces = tuple(s for s in args.spaces.split(",") if s)
    md_files = [
        p for p in root.rglob("*.md") if "node_modules" not in p.parts
    ] if root.exists() else []

    findings: list[dict] = []
    for md_file in md_files:
        findings.extend(check_file(md_file, root, spaces))
    if args.check_external:
        findings.extend(check_external(md_files, root, args.timeout))

    json.dump(
        {"error_types": list(ERROR_TYPES), "findings": findings},
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
