#!/usr/bin/env python3
"""missing-docs Phase-1 audit (ID-9.16).

Four sub-audits that each surface code surfaces present in the source tree but
absent from the docs corpus. Each sub-audit is independently invokable so the
two-phase workflow (audit -> draft) and the test fixtures can exercise them in
isolation.

Usage:
    python3 audit_docs.py --audit <name> --root <repo-root> [--docs-root <dir>]
                          [--terms <stale_terms.md>]

    <name> in: env-vars | cli-commands | mcp-routes | terminology

Output: JSON to stdout — {"audit": <name>, "missing": [ ... ]} where each entry
describes a surface with no documentation coverage (or, for terminology, a
stale-term occurrence). Exit code is 0 even when gaps are found; the gap list
is the signal (the skill body decides what to draft).

Spec: docs/specs/astro-starlight-docs-foundation/TECH.md §4.5; PRODUCT Inv-40.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _walk_files(root: Path, suffixes: tuple[str, ...]) -> list[Path]:
    if not root.exists():
        return []
    return [
        p
        for p in root.rglob("*")
        if p.is_file()
        and p.suffix in suffixes
        and "node_modules" not in p.parts
        and ".astro" not in p.parts
    ]


def _docs_corpus(docs_root: Path, subdir: str = "") -> str:
    base = docs_root / subdir if subdir else docs_root
    return "\n".join(_read(p) for p in _walk_files(base, (".md", ".mdx")))


def audit_env_vars(root: Path, docs_root: Path) -> list[dict]:
    """Env vars in .env.example or `process.env.X` not mentioned in runbooks."""
    names: set[str] = set()
    env_example = _read(root / ".env.example")
    for line in env_example.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            names.add(line.split("=", 1)[0].strip())
    code = "\n".join(
        _read(p)
        for d in ("lib", "app", "scripts")
        for p in _walk_files(root / d, (".ts", ".tsx", ".js"))
    )
    for m in re.finditer(r"process\.env\.([A-Z0-9_]+)", code):
        names.add(m.group(1))
    runbooks = _docs_corpus(docs_root, "runbooks")
    return [{"surface": n, "kind": "env-var"} for n in sorted(names) if n not in runbooks]


def audit_cli_commands(root: Path, docs_root: Path) -> list[dict]:
    """package.json scripts not mentioned anywhere in the runbooks docs."""
    pkg = _read(root / "package.json")
    try:
        scripts = json.loads(pkg).get("scripts", {}) if pkg else {}
    except json.JSONDecodeError:
        scripts = {}
    runbooks = _docs_corpus(docs_root, "runbooks")
    return [
        {"surface": name, "kind": "cli-command"}
        for name in sorted(scripts)
        if name not in runbooks
    ]


def audit_mcp_routes(root: Path, docs_root: Path) -> list[dict]:
    """MCP tool names + API route paths absent from the reference docs."""
    missing: list[dict] = []
    reference = _docs_corpus(docs_root, "reference")

    tool_src = "\n".join(
        _read(p) for p in _walk_files(root / "lib" / "mcp" / "tools", (".ts",))
    )
    for m in re.finditer(r"""name:\s*['"]([a-z0-9_.-]+)['"]""", tool_src):
        tool = m.group(1)
        if tool not in reference:
            missing.append({"surface": tool, "kind": "mcp-tool"})

    api_root = root / "app" / "api"
    if api_root.exists():
        for route in api_root.rglob("route.ts"):
            rel = route.relative_to(api_root).parent.as_posix()
            path = "/api/" + rel if rel != "." else "/api"
            if path not in reference:
                missing.append({"surface": path, "kind": "api-route"})
    return missing


def audit_terminology(docs_root: Path, terms_file: Path) -> list[dict]:
    """Occurrences of stale terms (per stale_terms.md) across the docs corpus."""
    stale: list[tuple[str, str]] = []
    for line in _read(terms_file).splitlines():
        # Table rows: | stale | canonical | ... |
        cells = [c.strip() for c in line.split("|") if c.strip()]
        if len(cells) >= 2 and cells[0].lower() not in ("stale", "term", "---"):
            term = cells[0].strip("`")
            if term and not term.startswith("-"):
                stale.append((term, cells[1].strip("`")))

    findings: list[dict] = []
    for doc in _walk_files(docs_root, (".md", ".mdx")):
        body = _read(doc)
        for term, canonical in stale:
            if re.search(rf"\b{re.escape(term)}\b", body):
                findings.append(
                    {
                        "surface": term,
                        "kind": "stale-term",
                        "canonical": canonical,
                        "path": doc.as_posix(),
                    }
                )
    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="missing-docs Phase-1 audit")
    parser.add_argument(
        "--audit",
        required=True,
        choices=["env-vars", "cli-commands", "mcp-routes", "terminology"],
    )
    parser.add_argument("--root", default=".")
    parser.add_argument("--docs-root", default=None)
    parser.add_argument("--terms", default=None)
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    docs_root = (
        Path(args.docs_root).resolve()
        if args.docs_root
        else root / "docs-site" / "src" / "content" / "docs"
    )

    if args.audit == "env-vars":
        missing = audit_env_vars(root, docs_root)
    elif args.audit == "cli-commands":
        missing = audit_cli_commands(root, docs_root)
    elif args.audit == "mcp-routes":
        missing = audit_mcp_routes(root, docs_root)
    else:
        terms = (
            Path(args.terms).resolve()
            if args.terms
            else Path(__file__).parent.parent / "references" / "stale_terms.md"
        )
        missing = audit_terminology(docs_root, terms)

    json.dump({"audit": args.audit, "missing": missing}, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
