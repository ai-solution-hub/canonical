#!/usr/bin/env python3
"""Wiring-census protocol runner — one command for the full four-surface sweep.

No sweep verdict is believed until it covers three surfaces (TS query chains +
Python + flow.py TableSchema declaratives) PLUS a pg_proc/migrations scan.
This runner executes that protocol end-to-end and fails LOUDLY when any
surface degrades:

  1. ``bun run ast-dataflow-py schema-uses --exclude-tests``
     → the Python + declarative evidence sidecar. HARD FAIL unless the
     envelope carries ``sqlglot: true`` — a sqlglot-less run contributes no
     SQL rows and must never be mistaken for a clean sweep.
  2. ``python3 scripts/census/pg_evidence.py``
     → the pg_proc/migrations sidecar (DB functions, views, triggers,
     seed/backfill DML). sqlglot is likewise mandatory there.
  3. ``bun run ast-dataflow schema-coverage --evidence <py> --evidence <pg>
     --report <out>/census-report.md``
     → the merged per-column verdicts (TS surface + both sidecars).

``--verify`` additionally re-runs the S507 regression fixtures — the census's
own acceptance test (both proven S507 blind spots plus a negative control):

  F1  pg sidecar surfaces the search-RPC readers of ``content_chunks.content``
      (S507 false alarm: "written-never-read" — the RPC readers were
      invisible).
  F2  merged verdict for ``content_chunks.content`` is ``wired``.
  F3  declarative writes are visible: ``reference_items.body`` carries a
      declarative-source write row and the merged verdict is ``wired``
      (S507 blind spot: TableSchema writes invisible → reference_items looked
      wholly unwritten).
  F4  NEGATIVE CONTROL: ``form_requirement_templates.requirement_text`` stays
      ``read-only`` — the S507-confirmed real gap must NOT be rescued by any
      of the new evidence surfaces.
  F5  the R8-protected columns are present in the verdict set and their
      verdicts are printed — the census may classify them, but they are NEVER
      blind-drop candidates (future source-binding register shape).

Verdict-reading rules (full protocol note:
docs-site specs/id-399-census-protocol/census-protocol.md):

- Declaration-only columns (TableSchema membership without a resolved write)
  are ``undecidable``, never ``wired`` — declared ≠ written.
- ``select('*')`` / ``SELECT *`` reads are wildcard evidence — never promote.
- api.* mirror-view reads are demoted to ``indirect`` by the pg producer —
  PostgREST exposure is not consumption.
- Heed the sidecar caveats echoed below (sqlFunctionSourceSites,
  sqlSitesUnresolvedDynamic, rpcPayloadSitesSkipped, dynamicSqlExecuteSites,
  livePgProcParity): each names evidence the sweep did NOT see.

Usage:
    python3 scripts/census/run_census.py [--out-dir DIR] [--live-json PATH]
                                         [--verify]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NoReturn

# R8-protected columns (initiative 12): NEVER blind-drop, whatever the
# verdict — they are the future source-binding register shape.
R8_PROTECTED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("source_documents", "auth"),
    ("source_documents", "cadence"),
    ("source_documents", "locator"),
    ("source_documents", "origin_type"),
    ("source_documents", "parent_id"),
)

FIXTURE_RPC_MIGRATION = (
    "supabase/migrations/"
    "20260716120000_id145_37_repoint_search_rpcs_to_form_instances.sql"
)


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "supabase" / "migrations").is_dir():
            return candidate
    raise SystemExit("run_census: could not locate the repo root — run from the repo.")


def run(cmd: list[str], cwd: Path, capture: bool = True) -> subprocess.CompletedProcess:
    print(f"[census] $ {' '.join(cmd)}", file=sys.stderr)
    return subprocess.run(
        cmd, cwd=cwd, capture_output=capture, text=True, check=False
    )


def fail(message: str) -> NoReturn:
    print(f"[census] FAIL — {message}", file=sys.stderr)
    raise SystemExit(1)


def echo_caveats(label: str, caveats: dict | None) -> None:
    if not caveats:
        return
    print(f"[census] {label} caveats:", file=sys.stderr)
    for key, value in caveats.items():
        rendered = value if not isinstance(value, list) else f"{len(value)} item(s)"
        print(f"[census]   {key}: {rendered}", file=sys.stderr)


def step_python_sidecar(repo_root: Path, out_dir: Path) -> dict:
    result = run(
        ["bun", "run", "ast-dataflow-py", "schema-uses", "--exclude-tests"], repo_root
    )
    if result.returncode != 0:
        fail(f"ast-dataflow-py schema-uses exited {result.returncode}: {result.stderr[-800:]}")
    try:
        envelope = json.loads(result.stdout)
    except json.JSONDecodeError as err:
        fail(f"ast-dataflow-py schema-uses did not emit JSON: {err}")
    if envelope.get("sqlglot") is not True:
        fail(
            "the Python sweep ran WITHOUT sqlglot (envelope sqlglot != true) — "
            "SQL rows are missing, verdicts would silently degrade. Install "
            "sqlglot (pip install -r requirements.txt) and re-run. "
            "{399.2}: this gate must never be bypassed."
        )
    path = out_dir / "py-evidence.json"
    path.write_text(json.dumps(envelope, indent=2) + "\n")
    print(f"[census] py sidecar: {len(envelope['rows'])} rows -> {path}", file=sys.stderr)
    echo_caveats("py", envelope.get("caveats"))
    return envelope


def step_pg_sidecar(repo_root: Path, out_dir: Path, live_json: Path | None) -> dict:
    path = out_dir / "pg-evidence.json"
    cmd = [
        sys.executable,
        "scripts/census/pg_evidence.py",
        "--repo-root",
        str(repo_root),
        "--out",
        str(path),
    ]
    if live_json is not None:
        cmd += ["--live-json", str(live_json)]
    result = run(cmd, repo_root)
    if result.returncode != 0:
        fail(f"pg_evidence exited {result.returncode}: {result.stderr[-800:]}")
    envelope = json.loads(path.read_text())
    print(f"[census] pg sidecar: {len(envelope['rows'])} rows -> {path}", file=sys.stderr)
    echo_caveats("pg", envelope.get("caveats"))
    return envelope


def step_merge(repo_root: Path, out_dir: Path) -> dict:
    report_path = out_dir / "census-report.md"
    result = run(
        [
            "bun",
            "run",
            "ast-dataflow",
            "schema-coverage",
            "--evidence",
            str(out_dir / "py-evidence.json"),
            "--evidence",
            str(out_dir / "pg-evidence.json"),
            "--report",
            str(report_path),
        ],
        repo_root,
    )
    if result.returncode != 0:
        fail(f"schema-coverage exited {result.returncode}: {result.stderr[-800:]}")
    try:
        response = json.loads(result.stdout)
    except json.JSONDecodeError as err:
        fail(f"schema-coverage did not emit JSON: {err}")
    if response.get("error"):
        fail(f"schema-coverage error: {response['error']}")
    verdicts_path = out_dir / "census-verdicts.json"
    verdicts_path.write_text(json.dumps(response, indent=2) + "\n")
    print(f"[census] merged verdicts -> {verdicts_path}", file=sys.stderr)
    print(f"[census] owner report    -> {report_path}", file=sys.stderr)
    print(f"[census] summary: {response.get('summary')}", file=sys.stderr)
    caveats = response.get("caveats", {})
    for merged in caveats.get("mergedEvidence", []):
        print(
            f"[census]   merged: {merged['source']} ({merged['rows']} rows)",
            file=sys.stderr,
        )
    unknown = caveats.get("evidenceUnknownTables")
    if unknown:
        print(
            f"[census]   evidenceUnknownTables: {len(unknown)} key(s) — producer/"
            "schema drift, inspect census-verdicts.json caveats",
            file=sys.stderr,
        )
    return response


def verify_fixtures(py_env: dict, pg_env: dict, coverage: dict) -> list[str]:
    """The S507 regression fixtures ({399.3}). Returns failure messages."""
    failures: list[str] = []
    verdicts = {(r["table"], r["column"]): r for r in coverage["results"]}

    # F1 — pg scan surfaces the invisible RPC readers of content_chunks.content.
    rpc_reads = [
        r
        for r in pg_env["rows"]
        if r["table"] == "content_chunks"
        and r["column"] == "content"
        and r["direction"] == "read"
        and r["confidence"] == "exact"
        and r["file"].startswith("supabase/migrations/")
    ]
    if not rpc_reads:
        failures.append(
            "F1: pg sidecar has NO exact migration-sourced read of "
            "content_chunks.content — the S507 'written-never-read' false "
            "alarm would reproduce."
        )
    elif not any(FIXTURE_RPC_MIGRATION in r["file"] for r in rpc_reads):
        failures.append(
            f"F1: expected a read from {FIXTURE_RPC_MIGRATION} (hybrid_search "
            f"snippet/rank reads); got only: {sorted({r['file'] for r in rpc_reads})}"
        )

    # F2 — merged verdict reclassifies.
    cc = verdicts.get(("content_chunks", "content"))
    if not cc or cc["verdict"] != "wired":
        failures.append(
            f"F2: content_chunks.content merged verdict is "
            f"{cc['verdict'] if cc else 'MISSING'}, expected wired."
        )

    # F3 — declarative writes visible (PR #150 half), reference_items wired.
    declarative_body_writes = [
        r
        for r in py_env["rows"]
        if r["table"] == "reference_items"
        and r["column"] == "body"
        and r["direction"] == "write"
        and r["source"] == "declarative"
    ]
    if not declarative_body_writes:
        failures.append(
            "F3: py sidecar has no declarative write row for "
            "reference_items.body — the TableSchema blind spot is back."
        )
    for column in ("body", "ingestion_source", "published_at"):
        row = verdicts.get(("reference_items", column))
        if not row or row["verdict"] != "wired":
            failures.append(
                f"F3: reference_items.{column} merged verdict is "
                f"{row['verdict'] if row else 'MISSING'}, expected wired."
            )

    # F4 — negative control: the real S507 gap must NOT be rescued.
    frt = verdicts.get(("form_requirement_templates", "requirement_text"))
    if not frt or frt["verdict"] != "read-only":
        failures.append(
            f"F4: form_requirement_templates.requirement_text verdict is "
            f"{frt['verdict'] if frt else 'MISSING'}, expected read-only — "
            "a rescued verdict here means the census is fabricating writers."
        )

    # F5 — R8-protected columns present + printed (never blind-drop).
    print("[census] R8-protected columns (NEVER blind-drop):", file=sys.stderr)
    for table, column in R8_PROTECTED_COLUMNS:
        row = verdicts.get((table, column))
        if row is None:
            failures.append(
                f"F5: R8-protected column {table}.{column} missing from the "
                "verdict set — schema drift; the protection list needs review."
            )
        else:
            print(
                f"[census]   {table}.{column}: {row['verdict']}", file=sys.stderr
            )
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "canonical-census",
        help="artefact directory (default: $TMPDIR/canonical-census)",
    )
    parser.add_argument(
        "--live-json",
        type=Path,
        default=None,
        help="pg_proc dump for the live parity check "
        "(see pg_evidence.py --emit-live-sql)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="run the S507 regression fixtures after the sweep ({399.3})",
    )
    args = parser.parse_args(argv)

    repo_root = find_repo_root(Path.cwd())
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    py_env = step_python_sidecar(repo_root, out_dir)
    pg_env = step_pg_sidecar(repo_root, out_dir, args.live_json)
    coverage = step_merge(repo_root, out_dir)

    if args.verify:
        failures = verify_fixtures(py_env, pg_env, coverage)
        if failures:
            for failure in failures:
                print(f"[census] VERIFY FAIL — {failure}", file=sys.stderr)
            return 1
        print("[census] VERIFY OK — all S507 regression fixtures pass.", file=sys.stderr)

    print(f"[census] done — artefacts in {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
