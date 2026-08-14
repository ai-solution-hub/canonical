"""Integration coverage for ingest/main.py — skipped by default.

HARD LIMITS (id-465 W2 dispatch brief): no live LLM calls and no writes to
any live database from this worktree. These tests document the intended
DB-backed coverage — the SEED-CONTRACT SQL mint round trip, and (once a
Coordinator-supervised DB + real-tier LLM are available) a full
`process_file` -> `declare_resolved` pass — and skip unless
`COCOINDEX_DB_DSN` is explicitly set by whoever is running them.

Real-tier and real-DB runs are Coordinator-supervised, later (DESIGN.md §7,
wave W4).
"""

from __future__ import annotations

import asyncio
import os
import uuid

import asyncpg
import pytest
from ingest.main import _resolve_source_identity

_DSN = os.environ.get("COCOINDEX_DB_DSN", "")

pytestmark = pytest.mark.skipif(
    not _DSN,
    reason="requires a live COCOINDEX_DB_DSN — Coordinator-supervised only",
)


async def _round_trip() -> tuple[uuid.UUID, uuid.UUID]:
    pool = await asyncpg.create_pool(_DSN, min_size=1, max_size=1)
    try:
        content_hash = uuid.uuid4().hex  # synthetic, never collides
        first_id = await _resolve_source_identity(
            pool,
            content_hash=content_hash,
            rel_path="markdown/w2-integration-fixture-a.md",
            filename="w2-integration-fixture-a.md",
            mime_type="text/markdown",
            file_size=42,
        )
        second_id = await _resolve_source_identity(
            pool,
            content_hash=content_hash,
            rel_path="markdown/w2-integration-fixture-b.md",
            filename="w2-integration-fixture-b.md",
            mime_type="text/markdown",
            file_size=42,
        )
        return first_id, second_id
    finally:
        await pool.close()


def test_resolve_source_identity_round_trips_on_content_hash() -> None:
    """Same content_hash at a new rel_path resolves to the STORED id and
    updates only the mutable logical_path (SEED-CONTRACT.md §3/§5).

    No pytest-asyncio dependency (not in pipeline/pyproject.toml's dep
    list) — plain `asyncio.run` so this doesn't silently no-op if the
    plugin is absent when a Coordinator eventually runs it for real.
    """
    first_id, second_id = asyncio.run(_round_trip())
    assert first_id == second_id
