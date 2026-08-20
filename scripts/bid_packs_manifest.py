#!/usr/bin/env python3
"""Regenerate bid-packs/MANIFEST.json and bid-packs/README.md (id-470 Q8, S578).

The packs are public procurement documents and stay committed; the manifest carries
per-file size + sha256 and each pack's source URLs (read from its README) so any copy can
be verified or re-downloaded. Run from the repo root: `python3 scripts/bid_packs_manifest.py`.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path("bid-packs")


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False).stdout


def main() -> None:
    tracked = set(_git("ls-files", str(ROOT)).split())
    ignored = {
        line[3:]
        for line in _git("status", "--ignored", "--porcelain", str(ROOT)).splitlines()
        if line.startswith("!!")
    }
    packs: dict[str, dict] = {}
    for d in sorted(p for p in ROOT.iterdir() if p.is_dir()):
        readme = d / "README.md"
        meta: dict = {"source_urls": [], "readme": readme.exists()}
        if readme.exists():
            txt = readme.read_text(errors="ignore")
            meta["source_urls"] = sorted(set(re.findall(r"https?://[^\s`)\]]+", txt)))
            first = txt.strip().splitlines()[0] if txt.strip() else ""
            meta["title"] = first[:160]
        files = []
        for f in sorted(d.rglob("*")):
            if f.is_file() and f.name != ".DS_Store":
                rel = str(f)
                files.append(
                    {
                        "path": rel,
                        "bytes": f.stat().st_size,
                        "sha256": hashlib.sha256(f.read_bytes()).hexdigest(),
                        "tracked": rel in tracked,
                        "gitignored": rel in ignored,
                    }
                )
        meta["files"] = files
        meta["file_count"] = len(files)
        meta["bytes"] = sum(x["bytes"] for x in files)
        packs[d.name] = meta

    out = {
        "generated_by": "scripts/bid_packs_manifest.py (id-470 Q8 — bid-packs stay committed; manifest added S578)",
        "note": "Public procurement documents. Re-download from source_urls if a file is missing; sha256 verifies integrity.",
        "packs": packs,
    }
    (ROOT / "MANIFEST.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    lines = [
        "# bid-packs — real UK procurement packs and reference corpora (public documents)",
        "",
        "Fixture set for id-470 (procurement rebuild). Packs stay **committed** (owner ruling S578, Q8): "
        "they are public documents, CI and per-client dogfooding seeding need them reachable, and "
        "`MANIFEST.json` carries per-file sizes + sha256 so any copy can be verified or re-downloaded "
        "from the source URLs.",
        "",
        "| Pack | Title | Files | Size | Source | README |",
        "| --- | --- | ---: | ---: | --- | --- |",
    ]
    for k, m in packs.items():
        src = m["source_urls"][0] if m["source_urls"] else "—"
        title = m.get("title", "—").replace("|", "/")
        readme_cell = "yes" if m["readme"] else "**missing**"
        lines.append(f"| `{k}` | {title} | {m['file_count']} | {m['bytes'] / 1e6:.1f} MB | {src} | {readme_cell} |")
    lines += ["", "Regenerate: `python3 scripts/bid_packs_manifest.py` (from the repo root).", ""]
    (ROOT / "README.md").write_text("\n".join(lines))
    for k, m in packs.items():
        print(k, m["file_count"], f"{m['bytes'] / 1e6:.1f}MB", "readme" if m["readme"] else "NO README")


if __name__ == "__main__":
    main()
