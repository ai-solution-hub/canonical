#!/usr/bin/env python3
"""pg-census evidence producer — the pg_proc/migrations half of the wiring census.

Scans ``supabase/migrations/*.sql`` for the DB-side column readers/writers that
neither ast-dataflow (TS query chains) nor ast-dataflow-py (Python SQL +
supabase-py + cocoindex declaratives) can see — the S507 audit's "invisible
writers" (§8): SQL/RPC function bodies, views, trigger bodies, DO blocks, and
migration seed/backfill DML. Emits the v1 evidence-sidecar contract consumed by
``bun run ast-dataflow schema-coverage --evidence <sidecar>``, so DB-function
evidence joins TS + Python evidence in one verdict for free.

Sidecar envelope (contract v1, mirrors tools/ast_dataflow_py/schema_uses.py)::

    { schemaVersion: 1, source: "pg-census", sqlglot: true,
      rows: [{ table, column|"*", direction, confidence, method, file, line,
               source }], caveats: {...} }

Method values (the ``method`` field discriminates evidence classes so the
sweep can weigh them — e.g. ``migration-dml`` is a HISTORICAL write, not a
runtime writer):

- ``pg-function-body``      — statement inside a live SQL/plpgsql function
                              (last-writer CREATE [OR REPLACE] across the full
                              migration history, DROP FUNCTION respected)
- ``pg-view``               — a live PUBLIC-schema view's defining SELECT
                              (last-writer, DROP VIEW respected)
- ``pg-view-api``           — a live api.* mirror view's SELECT. Column reads
                              are DEMOTED to ``indirect``: a generated 1:1
                              projection proves PostgREST *exposure*, not a
                              consumer — mirror reads must never wire a column
- ``pg-trigger-body``       — NEW./OLD. column references in a live trigger's
                              function body, attributed to the attached table
- ``migration-dml``         — top-level INSERT/UPDATE/DELETE (seed/backfill —
                              a HISTORICAL write, weigh accordingly)
- ``migration-do-block``    — statement inside a DO $$...$$ block
- ``seed-sql-dml`` /
  ``seed-sql-do-block``     — supabase/seed.sql statements (dev-reset seed
                              surface; the S507 §6.2 "migration seed data"
                              clusters actually live here)
- ``pg-function-body-live`` — statement inside a LIVE-ONLY function supplied
                              via --live-json (exists in pg_proc but in no
                              migration — out-of-band DDL)

Semantics (deliberate, documented in the census protocol note):

- sqlglot is REQUIRED — there is no regex fallback. Absence exits non-zero.
- Column attribution is scope-aware (sqlglot traverse_scope): qualified
  columns resolve through the alias map at ``exact``; unqualified columns
  resolve against the current public schema (parsed from
  supabase/types/database.types.ts) — exactly one in-scope candidate table
  → ``exact`` (Postgres's own resolution rule), several → ``indirect`` on
  each.
- ``SELECT *`` emits a table-scoped ``('*', read, wildcard)`` row per
  physical table in the statement — soft evidence, never wiring proof.
- Write direction is confined to columns the statement actually mutates:
  INSERT column lists / ON CONFLICT SET / UPDATE SET targets. Columns in
  WHERE / USING / RETURNING / DELETE predicates are READS. (This diverges
  from ast-dataflow-py's cruder "every column in a write statement is
  write-side" rule — divergence documented in the protocol note.)
- Rows naming tables/columns outside the CURRENT generated schema are
  dropped and counted (``rowsFilteredUnknownTableOrColumn``) — evidence for
  since-dropped objects must not pollute verdicts, but must not vanish
  silently either.

Live pg_proc cross-check (the parity complement): ``--emit-live-sql`` prints a
read-only query; run it against staging (any client — MCP execute_sql, psql),
save the JSON array, and pass it back via ``--live-json``. The scan then
reports live-only functions (out-of-band DDL — scanned for evidence when
``prosrc`` is included), migration-only functions (stale static evidence), and
body drift (md5 mismatch), all as caveats.

Usage:
    python3 scripts/census/pg_evidence.py [--repo-root PATH] [--out PATH]
                                          [--live-json PATH]
    python3 scripts/census/pg_evidence.py --emit-live-sql
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

SIDECAR_SCHEMA_VERSION = 1
SIDECAR_SOURCE = "pg-census"

CAVEAT_SAMPLE_CAP = 20

try:  # REQUIRED — no regex fallback (census {399.2} discipline). A missing
    # sqlglot is a broken census environment and must fail at import time,
    # loudly, before any evidence is produced.
    import sqlglot
    import sqlglot.expressions as exp
    from sqlglot.optimizer.scope import traverse_scope
except ImportError as _import_err:  # pragma: no cover — broken envs only
    raise SystemExit(
        "pg_evidence: sqlglot is REQUIRED (no regex fallback — census "
        "{399.2} discipline). Install it: pip install -r requirements.txt"
    ) from _import_err

# The read-only pg_proc dump query for --live-json. json_agg output shape:
# [{"schema": ..., "name": ..., "body_md5": ..., "prosrc": ...}, ...]
LIVE_PG_PROC_SQL = """\
SELECT COALESCE(json_agg(t ORDER BY t.schema, t.name), '[]'::json)
FROM (
  SELECT n.nspname AS schema, p.proname AS name,
         md5(p.prosrc) AS body_md5, p.prosrc AS prosrc
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'api') AND p.prokind IN ('f', 'p')
) t;
"""

IDENT = r'"?([A-Za-z_][\w]*)"?'
QUALIFIED = rf"(?:{IDENT}\s*\.\s*)?{IDENT}"

FUNC_CREATE_RE = re.compile(
    rf"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+{QUALIFIED}\s*\(", re.I
)
FUNC_DROP_RE = re.compile(
    rf"DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?{QUALIFIED}", re.I
)
VIEW_CREATE_RE = re.compile(
    rf"CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+{QUALIFIED}", re.I
)
VIEW_DROP_RE = re.compile(
    rf"DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?{QUALIFIED}", re.I
)
TRIGGER_CREATE_RE = re.compile(
    rf"CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+{IDENT}"
    rf"[\s\S]*?\bON\s+{QUALIFIED}"
    rf"[\s\S]*?\bEXECUTE\s+(?:FUNCTION|PROCEDURE)\s+{QUALIFIED}\s*\(",
    re.I,
)
TRIGGER_DROP_RE = re.compile(
    rf"DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?{IDENT}\s+ON\s+{QUALIFIED}", re.I
)
DO_BLOCK_RE = re.compile(r"\bDO\b", re.I)
DOLLAR_TAG_RE = re.compile(r"\$([A-Za-z_][\w]*)?\$")
DML_START_RE = re.compile(r"^\s*(INSERT|UPDATE|DELETE|MERGE)\b", re.I)

# Anchors for statement salvage inside plpgsql/DO bodies.
BODY_ANCHOR_RE = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|WITH|PERFORM|MERGE)\b", re.I)
# plpgsql `SELECT ... INTO var[, var]` / `RETURNING ... INTO var` — strip the
# INTO clause so sqlglot does not read it as a CTAS target. Negative
# lookbehinds keep INSERT INTO / MERGE INTO intact.
PLPGSQL_INTO_RE = re.compile(
    r"(?<!INSERT)(?<!MERGE)\s+INTO\s+(?:STRICT\s+)?"
    r"[A-Za-z_][\w]*(?:\s*\.\s*[\w]+)?(?:\s*,\s*[A-Za-z_][\w]*(?:\s*\.\s*[\w]+)?)*",
    re.I,
)
EXECUTE_DYNAMIC_RE = re.compile(r"\bEXECUTE\s+(?!FUNCTION\b|PROCEDURE\b)", re.I)
NEW_OLD_REF_RE = re.compile(r"\b(NEW|OLD)\s*\.\s*([A-Za-z_][\w]*)", re.I)
# `NEW.col :=` / `NEW.col =` immediately after a statement boundary is an
# assignment (write); everywhere else NEW./OLD. references are reads.
NEW_ASSIGN_RE = re.compile(
    r"(?:^|;|\bBEGIN\b|\bTHEN\b|\bELSE\b|\bLOOP\b|\bDECLARE\b)\s*"
    r"NEW\s*\.\s*([A-Za-z_][\w]*)\s*:?=[^=]",
    re.I,
)


# ─────────────────────────────────────────────────────────────────────────────
# Text utilities — comment stripping and offset math are the load-bearing
# parts: every downstream regex runs on comment-free text with ORIGINAL
# offsets, so file:line evidence stays truthful.
# ─────────────────────────────────────────────────────────────────────────────


def strip_comments(sql: str) -> str:
    """Blank out ``--`` and ``/* */`` comments, preserving every offset.

    String-aware (``'...'`` with ``''`` escapes) so an apostrophe or ``--``
    inside a literal never derails it. Newlines inside block comments are
    kept so line numbers survive.
    """
    out = list(sql)
    i, n = 0, len(sql)
    in_str = False
    while i < n:
        c = sql[i]
        if in_str:
            if c == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    i += 2
                    continue
                in_str = False
            i += 1
            continue
        if c == "'":
            in_str = True
            i += 1
            continue
        if c == "-" and i + 1 < n and sql[i + 1] == "-":
            j = sql.find("\n", i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = " "
            i = j
            continue
        if c == "/" and i + 1 < n and sql[i + 1] == "*":
            j = sql.find("*/", i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, min(j, n)):
                if out[k] != "\n":
                    out[k] = " "
            i = j
            continue
        i += 1
    return "".join(out)


def line_at(text: str, offset: int) -> int:
    """1-based line number of ``offset`` in ``text``."""
    return text.count("\n", 0, offset) + 1


@dataclass
class DollarRegion:
    start: int  # offset of first body char (after the opening tag)
    end: int  # offset of the closing tag
    open_start: int  # offset of the opening tag itself


def find_dollar_regions(clean: str) -> list[DollarRegion]:
    """Dollar-quoted regions on comment-stripped text, in order."""
    regions: list[DollarRegion] = []
    pos = 0
    while True:
        m = DOLLAR_TAG_RE.search(clean, pos)
        if not m:
            break
        close_literal = m.group(0)
        close_idx = clean.find(close_literal, m.end())
        if close_idx == -1:
            break
        regions.append(DollarRegion(start=m.end(), end=close_idx, open_start=m.start()))
        pos = close_idx + len(close_literal)
    return regions


def mask_regions(clean: str, regions: list[DollarRegion]) -> str:
    """Blank the region bodies (newline-preserving) for top-level scanning."""
    out = list(clean)
    for region in regions:
        for k in range(region.start, region.end):
            if out[k] != "\n":
                out[k] = " "
    return "".join(out)


def split_top_level_statements(masked: str) -> list[tuple[int, int]]:
    """(start, end) spans of ``;``-terminated statements, string/paren-aware."""
    spans: list[tuple[int, int]] = []
    start = 0
    depth = 0
    in_str = False
    i, n = 0, len(masked)
    while i < n:
        c = masked[i]
        if in_str:
            if c == "'":
                if i + 1 < n and masked[i + 1] == "'":
                    i += 2
                    continue
                in_str = False
        elif c == "'":
            in_str = True
        elif c == "(":
            depth += 1
        elif c == ")":
            depth = max(0, depth - 1)
        elif c == ";" and depth == 0:
            spans.append((start, i))
            start = i + 1
        i += 1
    if masked[start:].strip():
        spans.append((start, n))
    return spans


def _word_at(text: str, i: int, word: str) -> bool:
    """True when ``word`` sits at ``i`` with identifier boundaries."""
    end = i + len(word)
    if text[i:end].upper() != word:
        return False
    before_ok = i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")
    after_ok = end >= len(text) or not (text[end].isalnum() or text[end] == "_")
    return before_ok and after_ok


def salvage_statements(body: str) -> list[tuple[int, str]]:
    """(offset, statement_text) DML/SELECT candidates from a plpgsql/SQL body.

    Anchors at SELECT/INSERT/UPDATE/DELETE/WITH/PERFORM/MERGE outside string
    literals, cuts to the statement end: ``;`` at paren depth 0, a depth-0
    closing paren (subquery inside an expression), or a depth-0 LOOP/THEN
    (plpgsql FOR/IF headers). THEN only terminates OUTSIDE a CASE...END
    expression — a depth-0 ``CASE WHEN x THEN y END`` belongs to the
    statement. PERFORM is rewritten to SELECT.
    """
    statements: list[tuple[int, str]] = []
    i, n = 0, len(body)
    while i < n:
        m = BODY_ANCHOR_RE.search(body, i)
        if not m:
            break
        prefix = body[: m.start()]
        if prefix.replace("''", "").count("'") % 2 == 1:
            i = m.end()
            continue
        keyword = m.group(1).upper()
        pre_words = prefix.rstrip().rsplit(None, 1)
        prev_word = pre_words[-1].upper() if pre_words else ""
        # `FOR UPDATE` / `FOR NO KEY UPDATE` / `ON CONFLICT ... DO UPDATE`
        # belong to an enclosing statement (already yielded or irrelevant).
        if keyword == "UPDATE" and prev_word in {"FOR", "DO", "KEY"}:
            i = m.end()
            continue
        depth = 0
        case_depth = 0
        j = m.start()
        in_str = False
        while j < n:
            c = body[j]
            if in_str:
                if c == "'":
                    if j + 1 < n and body[j + 1] == "'":
                        j += 2
                        continue
                    in_str = False
            elif c == "'":
                in_str = True
            elif c == "(":
                depth += 1
            elif c == ")":
                if depth == 0:
                    break
                depth -= 1
            elif depth == 0:
                if _word_at(body, j, "CASE"):
                    case_depth += 1
                elif _word_at(body, j, "END"):
                    case_depth = max(0, case_depth - 1)
                elif c == ";" or _word_at(body, j, "LOOP"):
                    break
                elif case_depth == 0 and _word_at(body, j, "THEN"):
                    break
            j += 1
        text = body[m.start() : j]
        if keyword == "PERFORM":
            text = re.sub(r"^\s*PERFORM\b", "SELECT", text, flags=re.I)
        statements.append((m.start(), text))
        i = j + 1
    return statements


# ─────────────────────────────────────────────────────────────────────────────
# Schema — table → column set from the generated Supabase types. The
# generated file is the canonical schema (CLAUDE.md); programmatic reads of
# it are the sanctioned access path.
# ─────────────────────────────────────────────────────────────────────────────


def _brace_block(text: str, open_end: int) -> tuple[str, int]:
    """Content of a ``{...}`` block whose ``{`` ends at ``open_end``."""
    depth = 1
    i = open_end
    n = len(text)
    while i < n and depth > 0:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[open_end : i - 1], i


def parse_types_schema(types_path: Path) -> dict[str, set[str]]:
    """``Database['public']['Tables']`` → {table: {row columns}}."""
    src = types_path.read_text()
    public_m = re.search(r"\bpublic:\s*\{", src)
    if not public_m:
        raise SystemExit(f"pg_evidence: no `public:` block in {types_path}")
    tables_m = re.search(r"\bTables:\s*\{", src[public_m.end() :])
    if not tables_m:
        raise SystemExit(f"pg_evidence: no `Tables:` block in {types_path}")
    tables_block, _ = _brace_block(src, public_m.end() + tables_m.end())

    schema: dict[str, set[str]] = {}
    entry_re = re.compile(r"([A-Za-z_][\w]*)\s*:\s*\{")
    j = 0
    while True:
        entry = entry_re.search(tables_block, j)
        if not entry:
            break
        table_block, j = _brace_block(tables_block, entry.end())
        row_m = re.search(r"\bRow:\s*\{", table_block)
        if row_m:
            row_block, _ = _brace_block(table_block, row_m.end())
            columns = {
                col_m.group(1)
                for line in row_block.split("\n")
                if (col_m := re.match(r'\s*"?([A-Za-z_][\w]*)"?\??:', line))
            }
            schema[entry.group(1)] = columns
    if not schema:
        raise SystemExit(f"pg_evidence: parsed 0 tables from {types_path}")
    return schema


# ─────────────────────────────────────────────────────────────────────────────
# Migration corpus model — last-writer functions/views/triggers plus
# every-occurrence DO blocks and top-level DML.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FunctionDef:
    key: str  # schema.name
    raw_body: str  # byte-exact (pg_proc prosrc parity)
    clean_body: str  # comment-stripped, same offsets
    file: str
    body_line: int  # file line where the body starts


@dataclass
class ViewDef:
    key: str
    statement: str  # the full CREATE VIEW statement, comment-stripped
    file: str
    line: int


@dataclass
class BodyWorkItem:
    """A DO-block/DML occurrence scanned as-is (no last-writer semantics)."""

    kind: str  # 'do-block' | 'dml'
    text: str
    file: str
    line: int


@dataclass
class Caveats:
    unparsed_statements: list[dict[str, object]] = field(default_factory=list)
    unparsed_total: int = 0
    dynamic_sql_sites: list[dict[str, object]] = field(default_factory=list)
    dynamic_sql_total: int = 0
    functions_without_body: int = 0
    rows_filtered_unknown: int = 0
    trigger_functions_missing: list[str] = field(default_factory=list)
    triggers_on_unknown_tables: list[str] = field(default_factory=list)
    live_parity: dict[str, object] | None = None

    def note_unparsed(self, file: str, line: int, error: str) -> None:
        self.unparsed_total += 1
        if len(self.unparsed_statements) < CAVEAT_SAMPLE_CAP:
            self.unparsed_statements.append(
                {"file": file, "line": line, "error": error[:160]}
            )

    def note_dynamic(self, file: str, line: int) -> None:
        self.dynamic_sql_total += 1
        if len(self.dynamic_sql_sites) < CAVEAT_SAMPLE_CAP:
            self.dynamic_sql_sites.append({"file": file, "line": line})

    def to_json(self) -> dict[str, object]:
        return {
            "sqlUnparsedStatements": self.unparsed_total,
            "sqlUnparsedSample": self.unparsed_statements,
            "dynamicSqlExecuteSites": self.dynamic_sql_total,
            "dynamicSqlExecuteSample": self.dynamic_sql_sites,
            "functionsWithoutDollarBody": self.functions_without_body,
            "rowsFilteredUnknownTableOrColumn": self.rows_filtered_unknown,
            "triggerFunctionsMissing": self.trigger_functions_missing,
            "triggersOnUnknownTables": self.triggers_on_unknown_tables,
            "livePgProcParity": self.live_parity,
        }


@dataclass
class Corpus:
    functions: dict[str, FunctionDef] = field(default_factory=dict)
    views: dict[str, ViewDef] = field(default_factory=dict)
    # trigger key "name@schema.table" → (bare table, function key)
    triggers: dict[str, tuple[str, str]] = field(default_factory=dict)
    work_items: list[BodyWorkItem] = field(default_factory=list)


def _qualified_key(schema_part: str | None, name: str) -> str:
    return f"{(schema_part or 'public').lower()}.{name.lower()}"


def scan_migration_file(
    path: Path, rel: str, corpus: Corpus, caveats: Caveats, seed: bool = False
) -> None:
    raw = path.read_text()
    clean = strip_comments(raw)
    regions = find_dollar_regions(clean)
    masked = mask_regions(clean, regions)

    for seg_start, seg_end in split_top_level_statements(masked):
        segment = masked[seg_start:seg_end]
        stripped = segment.strip()
        if not stripped:
            continue
        seg_line = line_at(masked, seg_start + (len(segment) - len(segment.lstrip())))

        fn_m = FUNC_CREATE_RE.search(segment)
        if fn_m and stripped.upper().startswith("CREATE"):
            key = _qualified_key(fn_m.group(1), fn_m.group(2))
            region = next(
                (r for r in regions if seg_start <= r.open_start < seg_end), None
            )
            if region is None:
                caveats.functions_without_body += 1
                continue
            corpus.functions[key] = FunctionDef(
                key=key,
                raw_body=raw[region.start : region.end],
                clean_body=clean[region.start : region.end],
                file=rel,
                body_line=line_at(clean, region.start),
            )
            continue

        drop_fn_m = FUNC_DROP_RE.search(segment)
        if drop_fn_m and stripped.upper().startswith("DROP FUNCTION"):
            corpus.functions.pop(
                _qualified_key(drop_fn_m.group(1), drop_fn_m.group(2)), None
            )
            continue

        view_m = VIEW_CREATE_RE.search(segment)
        if view_m and stripped.upper().startswith("CREATE"):
            key = _qualified_key(view_m.group(1), view_m.group(2))
            corpus.views[key] = ViewDef(
                key=key,
                statement=clean[seg_start:seg_end],
                file=rel,
                line=seg_line,
            )
            continue

        drop_view_m = VIEW_DROP_RE.search(segment)
        if drop_view_m and stripped.upper().startswith("DROP"):
            corpus.views.pop(
                _qualified_key(drop_view_m.group(1), drop_view_m.group(2)), None
            )
            continue

        trig_m = TRIGGER_CREATE_RE.search(segment)
        if trig_m and stripped.upper().startswith("CREATE"):
            trig_name = trig_m.group(1).lower()
            table_key = _qualified_key(trig_m.group(2), trig_m.group(3))
            fn_key = _qualified_key(trig_m.group(4), trig_m.group(5))
            corpus.triggers[f"{trig_name}@{table_key}"] = (
                trig_m.group(3).lower(),
                fn_key,
            )
            continue

        drop_trig_m = TRIGGER_DROP_RE.search(segment)
        if drop_trig_m and stripped.upper().startswith("DROP TRIGGER"):
            trig_name = drop_trig_m.group(1).lower()
            table_key = _qualified_key(drop_trig_m.group(2), drop_trig_m.group(3))
            corpus.triggers.pop(f"{trig_name}@{table_key}", None)
            continue

        if stripped.upper().startswith("DO"):
            region = next(
                (r for r in regions if seg_start <= r.open_start < seg_end), None
            )
            if region is not None:
                corpus.work_items.append(
                    BodyWorkItem(
                        kind="seed-do-block" if seed else "do-block",
                        text=clean[region.start : region.end],
                        file=rel,
                        line=line_at(clean, region.start),
                    )
                )
            continue

        if DML_START_RE.match(stripped):
            corpus.work_items.append(
                BodyWorkItem(
                    kind="seed-dml" if seed else "dml",
                    text=clean[seg_start:seg_end],
                    file=rel,
                    line=seg_line,
                )
            )


# ─────────────────────────────────────────────────────────────────────────────
# Statement → evidence rows (scope-aware attribution)
# ─────────────────────────────────────────────────────────────────────────────

RowKey = tuple[str, str, str, str, str, str, int]  # + source appended at emit


def _physical_sources(scope) -> dict[str, str]:
    """alias → physical table name for one traverse_scope scope."""
    src_map: dict[str, str] = {}
    for alias, source in scope.sources.items():
        if isinstance(source, exp.Table) and source.name:
            src_map[alias] = source.name
    return src_map


def _query_read_hits(
    query, schema: dict[str, set[str]], hits: set[tuple[str, str, str, str]]
) -> None:
    """Scope-aware read attribution for a SELECT/UNION expression."""
    try:
        scopes = traverse_scope(query)
    except Exception:
        scopes = []
    if scopes:
        for scope in scopes:
            src_map = _physical_sources(scope)
            physical = set(src_map.values())
            for col in scope.columns:
                qualifier = col.table
                if qualifier:
                    table = src_map.get(qualifier)
                    if table:
                        hits.add((table, col.name, "read", "exact"))
                else:
                    candidates = [
                        t for t in physical if col.name in schema.get(t, set())
                    ]
                    if len(candidates) == 1:
                        hits.add((candidates[0], col.name, "read", "exact"))
                    else:
                        for t in candidates:
                            hits.add((t, col.name, "read", "indirect"))
    else:
        # traverse_scope handles SELECT shapes; fall back to a flat alias map.
        _flat_hits(query, schema, "read", hits)
    if query.find(exp.Star) is not None:
        for table in {t.name for t in query.find_all(exp.Table) if t.name}:
            if table in schema:
                hits.add((table, "*", "read", "wildcard"))


def _flat_hits(
    node, schema: dict[str, set[str]], direction: str, hits: set
) -> None:
    """Statement-wide alias-map attribution (non-SELECT shapes)."""
    ctes = {c.alias_or_name for c in node.find_all(exp.CTE)}
    alias_map: dict[str, str] = {}
    for t in node.find_all(exp.Table):
        if t.name and t.name not in ctes:
            alias_map[t.alias_or_name] = t.name
    physical = set(alias_map.values())
    for col in node.find_all(exp.Column):
        qualifier = col.table
        if qualifier:
            table = alias_map.get(qualifier)
            if table:
                hits.add((table, col.name, direction, "exact"))
        else:
            candidates = [t for t in physical if col.name in schema.get(t, set())]
            if len(candidates) == 1:
                hits.add((candidates[0], col.name, direction, "exact"))
            else:
                for t in candidates:
                    hits.add((t, col.name, direction, "indirect"))


def _insert_hits(
    stmt, schema: dict[str, set[str]], hits: set[tuple[str, str, str, str]]
) -> None:
    target = stmt.this
    columns: list[str] = []
    if isinstance(target, exp.Schema):
        columns = [
            ident.name
            for ident in target.expressions
            if isinstance(ident, (exp.Identifier, exp.Column))
        ]
        target_table = target.this.name if isinstance(target.this, exp.Table) else None
    else:
        target_table = target.name if isinstance(target, exp.Table) else None
    if not target_table:
        return
    for column in columns:
        hits.add((target_table, column, "write", "exact"))
    conflict = stmt.args.get("conflict")
    if conflict is not None:
        for eq in conflict.find_all(exp.EQ):
            left = eq.this
            if isinstance(left, exp.Column):
                hits.add((target_table, left.name, "write", "exact"))
    returning = stmt.args.get("returning")
    if returning is not None:
        for col in returning.find_all(exp.Column):
            hits.add((target_table, col.name, "read", "exact"))
    source = stmt.expression
    if source is not None and isinstance(source, (exp.Select, exp.Union)):
        _query_read_hits(source, schema, hits)


def _update_hits(
    stmt, schema: dict[str, set[str]], hits: set[tuple[str, str, str, str]]
) -> None:
    target = stmt.this
    target_table = target.name if isinstance(target, exp.Table) else None
    if not target_table:
        return
    set_columns: set[int] = set()
    for eq in stmt.expressions:
        if isinstance(eq, exp.EQ) and isinstance(eq.this, exp.Column):
            hits.add((target_table, eq.this.name, "write", "exact"))
            set_columns.add(id(eq.this))
    alias_map: dict[str, str] = {}
    for t in stmt.find_all(exp.Table):
        if t.name:
            alias_map[t.alias_or_name] = t.name
    physical = set(alias_map.values())
    for col in stmt.find_all(exp.Column):
        if id(col) in set_columns:
            continue
        qualifier = col.table
        if qualifier:
            table = alias_map.get(qualifier)
            if table:
                hits.add((table, col.name, "read", "exact"))
        else:
            candidates = [t for t in physical if col.name in schema.get(t, set())]
            if len(candidates) == 1:
                hits.add((candidates[0], col.name, "read", "exact"))
            else:
                for t in candidates:
                    hits.add((t, col.name, "read", "indirect"))


def statement_hits(
    stmt, schema: dict[str, set[str]]
) -> set[tuple[str, str, str, str]]:
    """(table, column|*, direction, confidence) hits for one parsed statement."""
    hits: set[tuple[str, str, str, str]] = set()
    if isinstance(stmt, (exp.Select, exp.Union)):
        _query_read_hits(stmt, schema, hits)
    elif isinstance(stmt, exp.Insert):
        _insert_hits(stmt, schema, hits)
    elif isinstance(stmt, exp.Update):
        _update_hits(stmt, schema, hits)
    elif isinstance(stmt, exp.Delete):
        _flat_hits(stmt, schema, "read", hits)
    elif isinstance(stmt, exp.Merge):
        _flat_hits(stmt, schema, "read", hits)
        target = stmt.this
        target_table = (
            target.this.name
            if isinstance(target, exp.Alias) and isinstance(target.this, exp.Table)
            else target.name if isinstance(target, exp.Table) else None
        )
        if target_table:
            for eq in stmt.find_all(exp.EQ):
                left = eq.this
                if isinstance(left, exp.Column) and (
                    not left.table or left.table == target.alias_or_name
                ):
                    hits.add((target_table, left.name, "write", "exact"))
    elif isinstance(stmt, exp.Create) and stmt.expression is not None:
        # CREATE VIEW / CTAS — the defining query is a read surface.
        if isinstance(stmt.expression, (exp.Select, exp.Union)):
            _query_read_hits(stmt.expression, schema, hits)
    return hits


def _emit(
    rows: set[tuple],
    hits: set[tuple[str, str, str, str]],
    schema: dict[str, set[str]],
    method: str,
    file: str,
    line: int,
    caveats: Caveats,
) -> None:
    """Filter hits against the current schema and add sidecar rows."""
    for table, column, direction, confidence in hits:
        if table not in schema or (column != "*" and column not in schema[table]):
            caveats.rows_filtered_unknown += 1
            continue
        rows.add((table, column, direction, confidence, method, file, line))


def scan_body(
    rows: set[tuple],
    body: str,
    schema: dict[str, set[str]],
    method: str,
    file: str,
    body_line: int,
    caveats: Caveats,
) -> None:
    """Salvage statements from a function/DO body and emit their evidence."""
    for match in EXECUTE_DYNAMIC_RE.finditer(body):
        caveats.note_dynamic(file, body_line + body.count("\n", 0, match.start()))
    for offset, text in salvage_statements(body):
        stmt_line = body_line + body.count("\n", 0, offset)
        cleaned = PLPGSQL_INTO_RE.sub(" ", text)
        try:
            statements = sqlglot.parse(cleaned, read="postgres")
        except Exception as err:  # parse failure is a caveat, never silent
            caveats.note_unparsed(file, stmt_line, str(err))
            continue
        for stmt in statements:
            if stmt is None:
                continue
            _emit(
                rows,
                statement_hits(stmt, schema),
                schema,
                method,
                file,
                stmt_line,
                caveats,
            )


def scan_statement_text(
    rows: set[tuple],
    text: str,
    schema: dict[str, set[str]],
    method: str,
    file: str,
    line: int,
    caveats: Caveats,
    demote_reads: bool = False,
) -> None:
    try:
        statements = sqlglot.parse(text, read="postgres")
    except Exception as err:
        caveats.note_unparsed(file, line, str(err))
        return
    for stmt in statements:
        if stmt is None:
            continue
        hits = statement_hits(stmt, schema)
        if demote_reads:
            hits = {
                (t, c, d, "indirect" if d == "read" and conf == "exact" else conf)
                for t, c, d, conf in hits
            }
        _emit(rows, hits, schema, method, file, line, caveats)


# ─────────────────────────────────────────────────────────────────────────────
# Trigger NEW./OLD. attribution
# ─────────────────────────────────────────────────────────────────────────────


def trigger_hits(
    body: str, table: str, schema: dict[str, set[str]]
) -> list[tuple[str, str, str, int]]:
    """(column, direction, confidence, offset) for NEW./OLD. references."""
    table_columns = schema.get(table, set())
    assignment_spans: list[tuple[int, int]] = []
    results: list[tuple[str, str, str, int]] = []
    for m in NEW_ASSIGN_RE.finditer(body):
        column = m.group(1)
        assignment_spans.append((m.start(), m.end()))
        if column in table_columns:
            results.append((column, "write", "exact", m.start()))
    for m in NEW_OLD_REF_RE.finditer(body):
        if any(s <= m.start() < e for s, e in assignment_spans):
            continue
        column = m.group(2)
        if column in table_columns:
            results.append((column, "read", "exact", m.start()))
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Live pg_proc parity
# ─────────────────────────────────────────────────────────────────────────────


def apply_live_parity(
    rows: set[tuple],
    live_path: Path,
    corpus: Corpus,
    schema: dict[str, set[str]],
    caveats: Caveats,
) -> None:
    payload = json.loads(live_path.read_text())
    if not isinstance(payload, list):
        raise SystemExit(
            "pg_evidence: --live-json must be a JSON array of "
            '{"schema", "name", "body_md5"[, "prosrc"]} rows '
            "(the --emit-live-sql query output)."
        )
    live: dict[str, dict] = {}
    for entry in payload:
        key = f"{entry['schema']}.{entry['name']}".lower()
        live[key] = entry

    static_keys = set(corpus.functions)
    live_keys = set(live)
    live_only = sorted(live_keys - static_keys)
    migration_only = sorted(static_keys - live_keys)
    drift = sorted(
        key
        for key in static_keys & live_keys
        if live[key].get("body_md5")
        and hashlib.md5(corpus.functions[key].raw_body.encode()).hexdigest()
        != live[key]["body_md5"]
    )
    caveats.live_parity = {
        "liveOnlyFunctions": live_only,
        "migrationOnlyFunctions": migration_only,
        "bodyDriftFunctions": drift,
        "liveFunctionCount": len(live_keys),
        "staticFunctionCount": len(static_keys),
    }
    # Live-only functions with a supplied body are still evidence — scan them
    # so out-of-band DDL cannot hide a reader/writer from the census.
    for key in live_only:
        prosrc = live[key].get("prosrc")
        if not prosrc:
            continue
        scan_body(
            rows,
            strip_comments(prosrc),
            schema,
            "pg-function-body-live",
            f"pg_proc:{key}",
            1,
            caveats,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────────────


def find_repo_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / "supabase" / "migrations").is_dir():
            return candidate
    raise SystemExit(
        "pg_evidence: could not locate supabase/migrations above "
        f"{start} — pass --repo-root."
    )


def build_evidence(
    repo_root: Path, live_json: Path | None
) -> tuple[list[dict[str, object]], Caveats]:
    schema = parse_types_schema(repo_root / "supabase" / "types" / "database.types.ts")
    migrations_dir = repo_root / "supabase" / "migrations"
    corpus = Corpus()
    caveats = Caveats()

    for path in sorted(migrations_dir.glob("*.sql")):
        rel = f"supabase/migrations/{path.name}"
        scan_migration_file(path, rel, corpus, caveats)

    seed_path = repo_root / "supabase" / "seed.sql"
    if seed_path.is_file():
        scan_migration_file(seed_path, "supabase/seed.sql", corpus, caveats, seed=True)

    rows: set[tuple] = set()

    for fn in corpus.functions.values():
        scan_body(
            rows, fn.clean_body, schema, "pg-function-body", fn.file, fn.body_line, caveats
        )

    for view in corpus.views.values():
        is_api_mirror = view.key.startswith("api.")
        scan_statement_text(
            rows,
            view.statement,
            schema,
            "pg-view-api" if is_api_mirror else "pg-view",
            view.file,
            view.line,
            caveats,
            demote_reads=is_api_mirror,
        )

    work_item_methods = {
        "do-block": ("migration-do-block", scan_body),
        "dml": ("migration-dml", scan_statement_text),
        "seed-do-block": ("seed-sql-do-block", scan_body),
        "seed-dml": ("seed-sql-dml", scan_statement_text),
    }
    for item in corpus.work_items:
        method, scanner = work_item_methods[item.kind]
        scanner(rows, item.text, schema, method, item.file, item.line, caveats)

    for trig_key, (table, fn_key) in sorted(corpus.triggers.items()):
        if table not in schema:
            # The attached table is gone from the current schema (dropped or
            # renamed away) — a stale binding, not a census surface. Renamed
            # tables keep their triggers in Postgres, so this is loud, not
            # silent: the live pg_proc parity check is the corrective.
            caveats.triggers_on_unknown_tables.append(f"{trig_key} -> {fn_key}")
            continue
        fn = corpus.functions.get(fn_key)
        if fn is None:
            caveats.trigger_functions_missing.append(f"{trig_key} -> {fn_key}")
            continue
        for column, direction, confidence, offset in trigger_hits(
            fn.clean_body, table, schema
        ):
            rows.add(
                (
                    table,
                    column,
                    direction,
                    confidence,
                    "pg-trigger-body",
                    fn.file,
                    fn.body_line + fn.clean_body.count("\n", 0, offset),
                )
            )

    if live_json is not None:
        apply_live_parity(rows, live_json, corpus, schema, caveats)

    sidecar_rows = [
        {
            "table": table,
            "column": column,
            "direction": direction,
            "confidence": confidence,
            "method": method,
            "file": file,
            "line": line,
            "source": "pg",
        }
        for table, column, direction, confidence, method, file, line in sorted(rows)
    ]
    return sidecar_rows, caveats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--repo-root", type=Path, default=None)
    parser.add_argument("--out", type=Path, default=None, help="default: stdout")
    parser.add_argument(
        "--live-json",
        type=Path,
        default=None,
        help="pg_proc dump (--emit-live-sql query output) for the parity check",
    )
    parser.add_argument(
        "--emit-live-sql",
        action="store_true",
        help="print the read-only pg_proc dump query and exit",
    )
    args = parser.parse_args(argv)

    if args.emit_live_sql:
        print(LIVE_PG_PROC_SQL)
        return 0

    started = time.monotonic()
    repo_root = args.repo_root or find_repo_root(Path.cwd())
    rows, caveats = build_evidence(repo_root, args.live_json)
    envelope = {
        "schemaVersion": SIDECAR_SCHEMA_VERSION,
        "source": SIDECAR_SOURCE,
        "generatedBy": "scripts/census/pg_evidence.py",
        "sqlglot": True,
        "durationMs": int((time.monotonic() - started) * 1000),
        "rows": rows,
        "caveats": caveats.to_json(),
    }
    text = json.dumps(envelope, indent=2)
    if args.out:
        args.out.write_text(text + "\n")
        print(
            f"pg_evidence: {len(rows)} rows -> {args.out} "
            f"(unparsed={caveats.unparsed_total}, "
            f"dynamicSql={caveats.dynamic_sql_total}, "
            f"filtered={caveats.rows_filtered_unknown})",
            file=sys.stderr,
        )
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
