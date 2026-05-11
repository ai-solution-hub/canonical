"""
Spike S1 — cocoindex 1.0.3 `managed_by="user"` live test against staging.

Question: when mounting an existing Postgres table with managed_by=ManagedBy.USER:
  - is DDL bypassed (no CREATE / DROP / ALTER) ?
  - does cocoindex's row upsert respect existing CHECK constraints?
  - does cocoindex's row upsert respect existing GENERATED ALWAYS columns?
  - does cocoindex's row upsert trigger existing BEFORE/AFTER triggers?
  - does cocoindex's row upsert play well with pgvector existing columns?

Run:
  cd <repo>
  export POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env.local | cut -d= -f2-)"
  spike/cocoindex_s1/.venv/bin/python3 spike/cocoindex_s1/probe_managed_by_user.py

Drops the test table at end (idempotent).
"""

from __future__ import annotations

import asyncio
import os
import re
import sys
import uuid
from pathlib import Path

import asyncpg

import cocoindex as coco
from cocoindex.connectors.postgres import (
    ColumnDef,
    TableSchema,
    declare_table_target,
    mount_table_target,
)
from cocoindex.connectorkits.target import ManagedBy


REPO_ROOT = Path(__file__).resolve().parents[2]
POOLER_URL_PATH = REPO_ROOT / "supabase" / ".temp" / "pooler-url"
PROJECT_REF_PATH = REPO_ROOT / "supabase" / ".temp" / "project-ref"
ENV_LOCAL_PATH = REPO_ROOT / ".env.local"
TEST_TABLE = "_spike_s1_cocoindex_test"


def build_dsn() -> str:
    """Build a Postgres DSN against the linked staging branch via the pooler."""
    pooler_url = POOLER_URL_PATH.read_text().strip()
    project_ref = PROJECT_REF_PATH.read_text().strip()
    pw_match = re.search(r"^POSTGRES_PASSWORD=(.*)$", ENV_LOCAL_PATH.read_text(), re.M)
    if not pw_match:
        raise RuntimeError("POSTGRES_PASSWORD missing from .env.local")
    pw = pw_match.group(1).strip().strip('"').strip("'")
    # pooler-url example: postgresql://aws-1-eu-west-2.pooler.supabase.com:5432/postgres
    # but the canonical format includes user@host. Reconstruct.
    host_match = re.search(r"://(?:[^@]*@)?([^/:]+(?::\d+)?)/(\w+)", pooler_url)
    if not host_match:
        raise RuntimeError(f"pooler-url not parseable: {pooler_url}")
    host_port = host_match.group(1)
    db = host_match.group(2)
    user = f"postgres.{project_ref}"
    # asyncpg requires URL-quoted password for special chars
    import urllib.parse
    pw_q = urllib.parse.quote(pw, safe="")
    return f"postgresql://{user}:{pw_q}@{host_port}/{db}"


SETUP_SQL = f"""
DROP TABLE IF EXISTS public.{TEST_TABLE} CASCADE;
CREATE TABLE public.{TEST_TABLE} (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_col text NOT NULL,
  vec_col vector(4),
  status text NOT NULL CHECK (status IN ('a', 'b', 'c')),
  generated_hash text GENERATED ALWAYS AS (md5(text_col)) STORED,
  updated_at timestamptz,
  trigger_fire_count int NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public._spike_s1_test_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  NEW.trigger_fire_count = COALESCE(OLD.trigger_fire_count, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _spike_s1_test_trigger ON public.{TEST_TABLE};
CREATE TRIGGER _spike_s1_test_trigger
  BEFORE INSERT OR UPDATE ON public.{TEST_TABLE}
  FOR EACH ROW EXECUTE FUNCTION public._spike_s1_test_trigger_fn();
"""

TEARDOWN_SQL = f"""
DROP TABLE IF EXISTS public.{TEST_TABLE} CASCADE;
DROP FUNCTION IF EXISTS public._spike_s1_test_trigger_fn();
"""


async def run_setup(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(SETUP_SQL)


async def run_teardown(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(TEARDOWN_SQL)


async def observe(pool: asyncpg.Pool, label: str) -> None:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f'SELECT id, text_col, vec_col::text, status, generated_hash, updated_at, trigger_fire_count FROM public.{TEST_TABLE} ORDER BY text_col'
        )
    print(f"\n--- {label} ---")
    for r in rows:
        print(dict(r))
    print(f"row_count={len(rows)}")


async def assert_table_unchanged(pool: asyncpg.Pool, ddl_marker: str) -> None:
    """Confirm the engine has NOT altered our DDL."""
    async with pool.acquire() as conn:
        cols = await conn.fetch(
            """
            SELECT column_name, data_type, is_nullable, generation_expression
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
            """,
            TEST_TABLE,
        )
        checks = await conn.fetch(
            """
            SELECT con.conname, pg_get_constraintdef(con.oid) AS def
            FROM pg_constraint con
            JOIN pg_class cls ON con.conrelid = cls.oid
            JOIN pg_namespace ns ON cls.relnamespace = ns.oid
            WHERE ns.nspname = 'public' AND cls.relname = $1
            ORDER BY con.conname
            """,
            TEST_TABLE,
        )
    print(f"\n--- schema-state @ {ddl_marker} ---")
    print("columns:")
    for c in cols:
        print(f"  {dict(c)}")
    print("constraints:")
    for c in checks:
        print(f"  {dict(c)}")


# ---- cocoindex flow definition ----

DB_CTX = coco.ContextKey[asyncpg.Pool]("db_pool")


async def upsert_row_flow(
    target_table,
    text_col: str,
    status: str,
    vec_col: list[float],
    pk_id: uuid.UUID | None = None,
):
    """Single-row upsert via cocoindex's row-level target."""
    pk_id = pk_id or uuid.uuid4()
    row = {
        "id": pk_id,
        "text_col": text_col,
        "vec_col": vec_col,
        "status": status,
        # intentionally do NOT include generated_hash, updated_at, or trigger_fire_count
    }
    target_table.declare_row(pk_id, row)
    return pk_id


async def main():
    dsn = build_dsn()
    print(f"connecting via: {dsn.split('@')[1]}")

    # Open one pool for setup/teardown/observation
    obs_pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
    try:
        await run_teardown(obs_pool)  # in case of leftover state
        await run_setup(obs_pool)
        await assert_table_unchanged(obs_pool, "after-setup")

        # Now build a cocoindex App that mounts the user-managed table
        # Open a second pool for cocoindex
        coco_pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)
        try:
            # Declare the schema cocoindex needs to know about (subset of real schema)
            table_schema = TableSchema(
                columns={
                    "id": ColumnDef(type="uuid", nullable=False),
                    "text_col": ColumnDef(type="text", nullable=False),
                    "vec_col": ColumnDef(type="vector(4)", nullable=True),
                    "status": ColumnDef(type="text", nullable=False),
                },
                primary_key=("id",),
            )

            async def app_main():
                # Provide the asyncpg.Pool as the context value
                async with coco.use_context(DB_CTX, coco_pool):
                    target = await mount_table_target(
                        DB_CTX,
                        TEST_TABLE,
                        table_schema,
                        managed_by=ManagedBy.USER,
                    )
                    # Try a clean upsert (status='a')
                    print("\n>>> Attempting upsert: status='a' (valid)")
                    await target.upsert(
                        ("alpha_id",),
                        {
                            "id": uuid.UUID("00000000-0000-4000-8000-000000000001"),
                            "text_col": "hello cocoindex",
                            "vec_col": [1.0, 2.0, 3.0, 4.0],
                            "status": "a",
                        },
                    )

                    # Try an upsert that violates the CHECK constraint
                    print("\n>>> Attempting upsert: status='z' (CHECK violation expected)")
                    try:
                        await target.upsert(
                            ("zeta_id",),
                            {
                                "id": uuid.UUID("00000000-0000-4000-8000-000000000002"),
                                "text_col": "should fail",
                                "vec_col": [0.0, 0.0, 0.0, 0.0],
                                "status": "z",  # not in CHECK
                            },
                        )
                        print("ERROR: CHECK violation did not raise!")
                    except Exception as e:
                        print(f"OK: CHECK violation raised {type(e).__name__}: {e}")

            await coco.start(coco.AppConfig(name="spike_s1_app", main_fn=app_main))
            # Wait for the app to finish its single update
            await asyncio.sleep(2.0)

        finally:
            await coco_pool.close()

        # Observe the table state after cocoindex did its thing
        await assert_table_unchanged(obs_pool, "after-cocoindex-mount")
        await observe(obs_pool, "rows-after-cocoindex")

    finally:
        await run_teardown(obs_pool)
        await obs_pool.close()


if __name__ == "__main__":
    asyncio.run(main())
