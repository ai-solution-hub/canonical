"""Regression tests for the pg-census evidence producer (scripts/census/).

Two layers:

1. Synthetic-corpus unit tests — a tiny fake repo (migrations + generated
   types) exercising each extraction surface and the last-writer/DROP
   semantics in isolation.
2. The S507 regression fixture against the REAL migration corpus — the
   census's own acceptance test: the pg scan must surface the search-RPC
   readers of ``content_chunks.content`` that the S507 audit could not see
   (the "written-never-read" false alarm), and the seed.sql writers behind
   the S507 §6.2 "migration seed data" clusters.

Static-only: no database, no bun — pure file scanning, so this belongs in the
default pytest lane.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.census.pg_evidence import (
    build_evidence,
    parse_types_schema,
    salvage_statements,
    strip_comments,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# The S507 false-alarm fixture: hybrid_search's last-writer body (snippet /
# rank / summary reads of content_chunks.content) lives in this migration.
# Retargeted when the id-417 DR-130 migration replaced hybrid_search — arm 2
# still reads cc.content, so the census must attribute the read to the new
# last-writer body.
FIXTURE_RPC_MIGRATION = (
    "supabase/migrations/"
    "20260805190000_id417_dr130_sd_ri_taxonomy_retirement.sql"
)


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — synthetic corpus
# ─────────────────────────────────────────────────────────────────────────────

TYPES_TS = """
export type Database = {
  public: {
    Tables: {
      widgets: {
        Row: {
          id: string
          name: string | null
          price: number | null
          status: string
        }
      }
      gadgets: {
        Row: {
          id: string
          widget_id: string | null
          updated_at: string
        }
      }
    }
  }
}
"""


def make_repo(tmp_path: Path, migrations: dict[str, str], seed: str | None = None) -> Path:
    root = tmp_path / "repo"
    (root / "supabase" / "migrations").mkdir(parents=True)
    (root / "supabase" / "types").mkdir(parents=True)
    (root / "supabase" / "types" / "database.types.ts").write_text(TYPES_TS)
    for name, sql in migrations.items():
        (root / "supabase" / "migrations" / name).write_text(sql)
    if seed is not None:
        (root / "supabase" / "seed.sql").write_text(seed)
    return root


def rows_of(root: Path) -> list[dict]:
    rows, _caveats = build_evidence(root, None)
    return rows


def keyed(rows: list[dict]) -> set[tuple]:
    return {
        (r["table"], r["column"], r["direction"], r["confidence"], r["method"])
        for r in rows
    }


def test_strip_comments_preserves_offsets_and_strings() -> None:
    sql = "SELECT 'a--b' AS x -- trailing ; comment\nFROM widgets;"
    clean = strip_comments(sql)
    assert len(clean) == len(sql)
    assert "'a--b'" in clean  # string literal untouched
    assert "comment" not in clean  # comment blanked
    assert clean.count("\n") == sql.count("\n")


def test_salvage_keeps_case_when_then_expressions_whole() -> None:
    body = """
BEGIN
  RETURN QUERY
  SELECT CASE WHEN w.status = 'live' THEN w.name ELSE NULL END
  FROM widgets w;
END
"""
    statements = salvage_statements(strip_comments(body))
    assert len(statements) == 1
    assert "ELSE NULL END" in statements[0][1]  # not truncated at THEN


def test_salvage_breaks_at_plpgsql_loop_and_rewrites_perform() -> None:
    body = """
BEGIN
  FOR rec IN SELECT id FROM widgets LOOP
    PERFORM name FROM widgets WHERE id = rec.id;
  END LOOP;
END
"""
    statements = salvage_statements(strip_comments(body))
    texts = [t for _, t in statements]
    assert any(t.strip().startswith("SELECT id FROM widgets") for t in texts)
    assert not any("LOOP" in t for t in texts)
    assert any(t.strip().startswith("SELECT name") for t in texts)  # PERFORM


def test_function_body_reads_are_scope_attributed(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {
            "001_fn.sql": """
CREATE OR REPLACE FUNCTION public.read_widgets() RETURNS TABLE(n text)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT w.name FROM widgets w JOIN gadgets g ON g.widget_id = w.id
  WHERE g.updated_at > now();
END
$$;
"""
        },
    )
    hits = keyed(rows_of(root))
    assert ("widgets", "name", "read", "exact", "pg-function-body") in hits
    assert ("gadgets", "widget_id", "read", "exact", "pg-function-body") in hits
    assert ("gadgets", "updated_at", "read", "exact", "pg-function-body") in hits


def test_last_writer_and_drop_function_semantics(tmp_path: Path) -> None:
    v1 = """
CREATE FUNCTION public.f1() RETURNS void LANGUAGE sql AS $$
  SELECT price FROM widgets;
$$;
CREATE FUNCTION public.f2() RETURNS void LANGUAGE sql AS $$
  SELECT status FROM widgets;
$$;
"""
    v2 = """
CREATE OR REPLACE FUNCTION public.f1() RETURNS void LANGUAGE sql AS $$
  SELECT name FROM widgets;
$$;
DROP FUNCTION IF EXISTS public.f2();
"""
    root = make_repo(tmp_path, {"001_v1.sql": v1, "002_v2.sql": v2})
    hits = keyed(rows_of(root))
    # f1 superseded: only the LAST body counts.
    assert ("widgets", "name", "read", "exact", "pg-function-body") in hits
    assert ("widgets", "price", "read", "exact", "pg-function-body") not in hits
    # f2 dropped: contributes nothing.
    assert ("widgets", "status", "read", "exact", "pg-function-body") not in hits


def test_insert_writes_and_select_source_reads(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {
            "001_dml.sql": """
INSERT INTO widgets (id, name) SELECT g.id, g.widget_id FROM gadgets g;
"""
        },
    )
    hits = keyed(rows_of(root))
    assert ("widgets", "id", "write", "exact", "migration-dml") in hits
    assert ("widgets", "name", "write", "exact", "migration-dml") in hits
    assert ("gadgets", "widget_id", "read", "exact", "migration-dml") in hits


def test_update_set_is_write_and_where_is_read(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {"001_up.sql": "UPDATE widgets SET name = 'x' WHERE status = 'old';\n"},
    )
    hits = keyed(rows_of(root))
    assert ("widgets", "name", "write", "exact", "migration-dml") in hits
    assert ("widgets", "status", "read", "exact", "migration-dml") in hits


def test_view_reads_and_api_mirror_demotion(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {
            "001_views.sql": """
CREATE VIEW public.widget_names AS SELECT w.name FROM widgets w;
CREATE VIEW api.widgets AS SELECT w.id, w.price FROM public.widgets w;
"""
        },
    )
    rows = rows_of(root)
    hits = keyed(rows)
    assert ("widgets", "name", "read", "exact", "pg-view") in hits
    # api.* mirror projections are exposure, not consumption — demoted.
    assert ("widgets", "price", "read", "indirect", "pg-view-api") in hits
    assert not any(
        r["method"] == "pg-view-api" and r["confidence"] == "exact" for r in rows
    )


def test_drop_view_removes_evidence(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {
            "001_view.sql": "CREATE VIEW public.v AS SELECT name FROM widgets;\n",
            "002_drop.sql": "DROP VIEW IF EXISTS public.v;\n",
        },
    )
    assert not any(r["method"] == "pg-view" for r in rows_of(root))


def test_trigger_new_assignment_is_write_and_reference_is_read(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {
            "001_trig.sql": """
CREATE OR REPLACE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := 'touched';
  IF NEW.name IS NULL THEN
    NEW.status := 'unnamed';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER widgets_touch BEFORE UPDATE ON public.widgets
FOR EACH ROW EXECUTE FUNCTION public.touch();
"""
        },
    )
    hits = keyed(rows_of(root))
    assert ("widgets", "status", "write", "exact", "pg-trigger-body") in hits
    assert ("widgets", "name", "read", "exact", "pg-trigger-body") in hits


def test_seed_sql_is_a_scanned_surface_with_its_own_method(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {"001_noop.sql": "SELECT 1;\n"},
        seed="INSERT INTO public.widgets (id, name) VALUES ('1', 'seeded');\n",
    )
    hits = keyed(rows_of(root))
    assert ("widgets", "id", "write", "exact", "seed-sql-dml") in hits
    assert ("widgets", "name", "write", "exact", "seed-sql-dml") in hits


def test_rows_outside_current_schema_are_filtered_and_counted(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {"001_stale.sql": "INSERT INTO retired_table (a, b) VALUES (1, 2);\n"},
    )
    rows, caveats = build_evidence(root, None)
    assert not any(r["table"] == "retired_table" for r in rows)
    assert caveats.rows_filtered_unknown > 0


def test_select_star_emits_soft_wildcard_only(tmp_path: Path) -> None:
    root = make_repo(
        tmp_path,
        {"001_v.sql": "CREATE VIEW public.all_widgets AS SELECT * FROM widgets;\n"},
    )
    rows = [r for r in rows_of(root) if r["table"] == "widgets"]
    assert any(r["column"] == "*" and r["confidence"] == "wildcard" for r in rows)
    # A bare star never fabricates exact per-column reads.
    assert not any(r["column"] != "*" and r["confidence"] == "exact" for r in rows)


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — the S507 regression fixture against the real corpus ({399.3})
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def real_corpus() -> tuple[list[dict], object]:
    return build_evidence(REPO_ROOT, None)


def test_s507_false_alarm_content_chunks_content_has_db_readers(
    real_corpus: tuple[list[dict], object],
) -> None:
    """The S507 audit rated content_chunks.content 'written-never-read'.

    FALSE ALARM: the Postgres search RPCs read it (snippet/rank/summary) —
    hybrid_search's last-writer body in the id145_37 migration. The pg scan
    must surface that read at exact confidence, or the census regresses to
    the S507 blind spot.
    """
    rows, _ = real_corpus
    reads = [
        r
        for r in rows
        if r["table"] == "content_chunks"
        and r["column"] == "content"
        and r["direction"] == "read"
        and r["confidence"] == "exact"
        and r["method"] == "pg-function-body"
    ]
    assert reads, "no exact function-body read of content_chunks.content"
    assert any(r["file"] == FIXTURE_RPC_MIGRATION for r in reads), (
        f"expected a read from {FIXTURE_RPC_MIGRATION}; got "
        f"{sorted({r['file'] for r in reads})}"
    )


def test_s507_seed_data_clusters_have_visible_writers(
    real_corpus: tuple[list[dict], object],
) -> None:
    """S507 §6.2: a seed.sql INSERT is a write surface the census must see,
    so read-never-written seed clusters stop false-alarming.

    id-433 retargeted this from entity_aliases (whose core seed rows went with
    the deterministic naming layer, DR-140) to layer_vocabulary, which §4c
    still seeds.
    """
    rows, _ = real_corpus
    seed_writes = {
        (r["table"], r["column"])
        for r in rows
        if r["method"] == "seed-sql-dml" and r["direction"] == "write"
    }
    for column in ("key", "label", "description"):
        assert ("layer_vocabulary", column) in seed_writes


def test_real_corpus_rows_all_join_against_current_schema(
    real_corpus: tuple[list[dict], object],
) -> None:
    """Every emitted row must name a current table+column (or '*') — the
    join guarantee that keeps pg-census out of schema-coverage's
    evidenceUnknownTables caveat."""
    rows, _ = real_corpus
    schema = parse_types_schema(
        REPO_ROOT / "supabase" / "types" / "database.types.ts"
    )
    for r in rows:
        assert r["table"] in schema
        assert r["column"] == "*" or r["column"] in schema[r["table"]]


def test_real_corpus_sidecar_contract_fields(
    real_corpus: tuple[list[dict], object],
) -> None:
    """Rows must satisfy the v1 evidence-sidecar contract the TS consumer
    validates (schema-coverage loadEvidenceSidecars)."""
    rows, _ = real_corpus
    assert rows, "real corpus produced no rows"
    for r in rows[:200]:
        assert r["direction"] in ("read", "write")
        assert r["confidence"] in ("exact", "wildcard", "indirect")
        for key in ("table", "column", "method", "file", "source"):
            assert isinstance(r[key], str) and r[key]
        assert isinstance(r["line"], int)
