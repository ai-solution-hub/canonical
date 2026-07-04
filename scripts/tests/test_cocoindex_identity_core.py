"""ID-138 {138.10} — admission-minted identity core (R(id) / DR-024 clause i).

Behaviour proof for the walk re-key onto the M2 content_hash-first resolver
(`public.resolve_or_mint_source_identity`, {138.6}). The walk STOPS deriving
identity from the live `rel_path` (the attribute clients mutate) and instead
resolves the STORED identity by `content_hash` first:

  - **Same bytes at a NEW rel_path** → the resolver returns the SAME
    `source_document_id`; `logical_path` tracks the new path; the derived rows
    (`ci:` / `qa:`) are NOT re-minted (their PKs are keyed on the stored
    `source_document_id`, not `rel_path`), so a rename does not re-mint the
    derived graph — TECH.md §2.2 R(id).
  - **A genuinely new content_hash** → a NEW identity (a different document is a
    different source_document_id).
  - **`_upsert_source_document` freezes `storage_path`** (the R(a) SEED-CONTRACT
    key) and updates only the mutable `logical_path` on an `ON CONFLICT (id)`
    match, and it PRESERVES the lifecycle columns (`admission_status`, …) rather
    than clobbering promoted/curated state (R(d)/DR-026).

Mocked end-to-end (no cocoindex engine, no Anthropic, no DB): a content_hash-first
resolver pool double stands in for `resolve_or_mint_source_identity` over the
`DB_CTX` raw asyncpg pool, exactly as the production walk calls it. `pytest` runs
from the worktree CWD (namespace-package hazard — scripts/CLAUDE.md).

Reference: specs/id-138-corpus-durable-home/TECH.md §2.2 R(id), §3.2 P1/P2/P3.
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

import pytest

from conftest import fresh_flow_module  # noqa: E402


def _flow_module():
    return fresh_flow_module()


# ── SEED-CONTRACT namespace (pinned identical to flow._KH_PIPELINE_DOC_NS and the
# M2 resolver / reference_ingest SQL precedent). A frozen literal so a namespace
# drift fails loudly rather than silently orphaning the citation graph. ─────────
_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


# ── Fakes ──────────────────────────────────────────────────────────────────


class _FakeTarget:
    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """Localfs File stand-in: async read/size + content_fingerprint over `data`.

    `content_fingerprint` returns raw bytes (the real FileLike contract); the
    production walk hexes it into the `content_hash` the resolver keys on. The
    LOGICAL `file_path.path` is the source-relative rel_path (prod post
    `_to_source_relative`, called with `flow_source_path=None` here so the path
    is used verbatim), decoupled from `data` so the SAME bytes can be presented
    at DIFFERENT paths (the rename case).
    """

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, *, data: bytes) -> None:
        self.file_path = _FakeFile._FilePath(Path(rel_path))
        self._data = data

    async def size(self) -> int:
        return len(self._data)

    async def read(self) -> bytes:
        return self._data

    async def read_text(self) -> str:
        return self._data.decode("utf-8")

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._data).digest()


# ── content_hash-first resolver pool double ─────────────────────────────────
# Stands in for `public.resolve_or_mint_source_identity` over the DB_CTX raw
# asyncpg pool. The `registry` dict (content_hash -> minted id) persists across
# walks to simulate the DB, so a re-walk of the same bytes RESOLVES rather than
# re-mints. The mint formula mirrors the real resolver EXACTLY
# (`uuid5(NS, "sd:"+rel_path)` on first admission), so this double is faithful to
# the SEED-CONTRACT the SQL fn implements.


class _ResolverConn:
    def __init__(self, registry: dict) -> None:
        self._registry = registry
        self.executed: list[tuple[str, tuple]] = []
        self.resolved: list[dict] = []

    async def fetchrow(self, sql: str, *args: object):
        assert "resolve_or_mint_source_identity" in sql, (
            "the walk must resolve identity via the M2 resolver fn"
        )
        content_hash, rel_path = args[0], args[1]
        existing = self._registry.get(content_hash)
        if existing is not None:
            # content_hash-first: same bytes at a NEW path resolve to the STORED
            # id; the mutable logical_path is updated, identity never re-derived.
            sd_id, was_minted = existing, False
        else:
            # genuinely new content_hash: mint ONCE on the SEED-CONTRACT formula.
            sd_id = uuid.uuid5(_NS, f"sd:{rel_path}")
            self._registry[content_hash] = sd_id
            was_minted = True
        self.resolved.append(
            {
                "content_hash": content_hash,
                "rel_path": rel_path,
                "source_document_id": sd_id,
                "was_minted": was_minted,
            }
        )
        return {"source_document_id": sd_id, "was_minted": was_minted}

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "INSERT 0 1"


class _ResolverAcquire:
    def __init__(self, conn: _ResolverConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _ResolverConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _ResolverPool:
    def __init__(self, registry: dict) -> None:
        self.conn = _ResolverConn(registry)

    def acquire(self) -> _ResolverAcquire:
        return _ResolverAcquire(self.conn)


def _sd_insert_args(conn: _ResolverConn) -> dict:
    """Reconstruct the source_documents INSERT payload from the raw-pool capture."""
    for sql, args in conn.executed:
        if "INSERT INTO public.source_documents" not in sql:
            continue
        cols = sql.split("(", 1)[1].split(")", 1)[0]
        columns = [c.strip() for c in cols.split(",")]
        return dict(zip(columns, args))
    raise AssertionError("no source_documents INSERT captured")


def _sd_upsert_sql(conn: _ResolverConn) -> str:
    for sql, _ in conn.executed:
        if "INSERT INTO public.source_documents" in sql:
            return sql
    raise AssertionError("no source_documents INSERT captured")


def _stub_seams(flow: object, monkeypatch: pytest.MonkeyPatch, *, markdown: str) -> None:
    async def _fake_convert(file: object) -> str:
        return markdown

    async def _fake_classification(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
            "suggested_title": "Doc Title",
        }

    async def _fake_qa(content_text: str):
        return {
            "qa_pairs": [
                {"question_text": "What is X?", "answer_text": "X is Y."},
                {"question_text": "What is Z?", "answer_text": "Z is W."},
            ]
        }

    async def _fake_entities(content_text: str):
        return []

    async def _fake_relationships(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _walk(
    flow: object,
    registry: dict,
    rel_path: str,
    data: bytes,
    monkeypatch: pytest.MonkeyPatch,
) -> dict:
    """Drive one real `ingest_file` content-branch walk against the resolver pool.

    Returns the per-walk capture: ci/qa declared rows, the reconstructed sd
    INSERT payload, and the resolver call log.
    """
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    _stub_seams(flow, monkeypatch, markdown="# H\n\n" + data.decode("utf-8", "ignore"))

    pool = _ResolverPool(registry)
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=uuid.uuid4()):
            # cc_target=None → chunk stage skipped (chunk re-key is proven in
            # test_cocoindex_chunking.py); this suite proves the sd/ci/qa core.
            await flow.ingest_file(_FakeFile(rel_path, data=data), ci, qa, sd, em, None, None)

    asyncio.run(_exercise())
    return {
        "ci": ci.rows,
        "qa": qa.rows,
        "sd_insert": _sd_insert_args(pool.conn),
        "sd_sql": _sd_upsert_sql(pool.conn),
        "resolved": pool.conn.resolved,
    }


# ── R(id): admission-minted, rename-tolerant identity ────────────────────────


class TestAdmissionMintedIdentity:
    def test_same_bytes_new_path_resolves_same_identity(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A rename (same bytes, new rel_path) resolves to the SAME stored id —
        identity is content_hash-first, NOT re-derived from the mutable path."""
        flow = _flow_module()
        registry: dict = {}
        same_bytes = b"identical corpus document bytes, moved to a new path"

        first = _walk(flow, registry, "corpus/original-name.md", same_bytes, monkeypatch)
        renamed = _walk(flow, registry, "corpus/renamed/new-name.md", same_bytes, monkeypatch)

        # Same content_hash resolved on both walks → SAME source_document_id.
        assert first["resolved"][0]["was_minted"] is True
        assert renamed["resolved"][0]["was_minted"] is False, (
            "a rename of the same bytes must RESOLVE (not re-mint) the identity"
        )
        sd_id = first["sd_insert"]["id"]
        assert renamed["sd_insert"]["id"] == sd_id, (
            "same bytes at a new path must keep the SAME source_document_id (R(id))"
        )

        # logical_path tracks the CURRENT path (mutable attribute); storage_path
        # stays the ADMISSION-time key (frozen) — both walks pass their own path
        # as logical_path, and _upsert freezes storage_path on the conflict.
        assert first["sd_insert"]["logical_path"] == "corpus/original-name.md"
        assert renamed["sd_insert"]["logical_path"] == "corpus/renamed/new-name.md"

    def test_derived_seeds_rekey_onto_stored_source_document_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`ci:` / `qa:` PKs are keyed on the STORED source_document_id, not
        rel_path — so a rename does NOT re-mint the derived rows."""
        flow = _flow_module()
        registry: dict = {}
        same_bytes = b"derived-graph stability under a rename"

        first = _walk(flow, registry, "corpus/a.md", same_bytes, monkeypatch)
        renamed = _walk(flow, registry, "corpus/b.md", same_bytes, monkeypatch)

        sd_id = first["sd_insert"]["id"]

        # ci PK is uuid5("ci:"+<source_document_id>), NOT the legacy uuid5("ci:"+rel_path).
        assert first["ci"][0]["id"] == uuid.uuid5(_NS, f"ci:{sd_id}")
        assert first["ci"][0]["id"] != uuid.uuid5(_NS, "ci:corpus/a.md"), (
            "ci seed must re-key onto source_document_id, not rel_path (R(id)/R(e))"
        )
        # qa PKs likewise re-key onto the stored id, per pair index.
        assert [r["id"] for r in first["qa"]] == [
            uuid.uuid5(_NS, f"qa:{sd_id}:0"),
            uuid.uuid5(_NS, f"qa:{sd_id}:1"),
        ]

        # A rename → identical derived PKs (NOT re-minted), because the seed is
        # the stable id, not the path.
        assert renamed["ci"][0]["id"] == first["ci"][0]["id"], (
            "a rename must NOT re-mint the content_items row"
        )
        assert [r["id"] for r in renamed["qa"]] == [r["id"] for r in first["qa"]], (
            "a rename must NOT re-mint the q_a_extractions rows"
        )
        # The re-keyed rows still FK the resolved source id.
        assert first["ci"][0]["source_document_id"] == sd_id
        assert first["qa"][0]["source_document_id"] == sd_id

    def test_new_content_hash_mints_new_identity(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Different bytes → a genuinely new content_hash → a NEW identity."""
        flow = _flow_module()
        registry: dict = {}

        doc_x = _walk(flow, registry, "corpus/x.md", b"document X bytes", monkeypatch)
        doc_y = _walk(flow, registry, "corpus/y.md", b"document Y bytes differ", monkeypatch)

        assert doc_x["resolved"][0]["was_minted"] is True
        assert doc_y["resolved"][0]["was_minted"] is True
        assert doc_y["sd_insert"]["id"] != doc_x["sd_insert"]["id"], (
            "a new content_hash must mint a NEW source_document_id"
        )
        # Derived rows of the two documents are disjoint (no cross-contamination).
        assert doc_x["ci"][0]["id"] != doc_y["ci"][0]["id"]


# ── R(id)/R(a): _upsert_source_document freeze + no-clobber contract ─────────


class TestUpsertSourceDocumentContract:
    def test_storage_path_frozen_logical_path_mutable_on_conflict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """On `ON CONFLICT (id)` the raw upsert FREEZES storage_path (the R(a)
        admission key) and updates only the mutable logical_path."""
        flow = _flow_module()
        sql = _walk(flow, {}, "corpus/doc.md", b"contract-proof bytes", monkeypatch)["sd_sql"]

        conflict = sql.split("ON CONFLICT (id) DO UPDATE SET", 1)[1]
        assert "storage_path = EXCLUDED.storage_path" not in conflict, (
            "storage_path is the FROZEN SEED-CONTRACT key — never updated on conflict"
        )
        assert "logical_path" in conflict, (
            "logical_path is the MUTABLE path attribute — updated on conflict (R(id))"
        )

    def test_lifecycle_columns_added_to_payload_and_preserved_on_conflict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Lifecycle columns are written on admission but PRESERVED (not clobbered)
        on a re-walk conflict, so a tombstoned/curated row is not resurrected."""
        flow = _flow_module()
        out = _walk(flow, {}, "corpus/doc.md", b"lifecycle-proof bytes", monkeypatch)
        insert_cols = out["sd_insert"].keys()
        conflict = out["sd_sql"].split("ON CONFLICT (id) DO UPDATE SET", 1)[1]

        assert {"admission_status", "retention_class", "origin_type"} <= set(insert_cols), (
            "lifecycle columns must be part of the admission payload (R(b))"
        )
        assert "admission_status = EXCLUDED.admission_status" not in conflict, (
            "admission_status must be PRESERVED on conflict — a re-walk must not "
            "resurrect a tombstoned row (R(d)/DR-026)"
        )
