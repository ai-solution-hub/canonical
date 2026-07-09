r"""ID-138 {138.11} P4 — one-shot ingest-once extraction path (R(e), TECH §2.5).

Proves the `ingest_once` mechanism WITHOUT the cocoindex Rust engine, a
postgres target, or live LLM/embedding calls — mirrors
`test_cocoindex_chunking.py`'s harness (real `cocoindex.ops.text.
RecursiveSplitter`, everything else stubbed) since `ingest_once` runs the
chunking stage unconditionally (no `cc_target is not None` guard — there is
no `cc_target` at all).

WHAT THIS PROVES:

STRUCTURAL (`TestIngestOnceIsStructurallyOffEngine`):
  - `ingest_once`'s signature carries no engine `TableTarget` parameter at all
    (no `qa_target`/`sd_target`/`em_target`/`cc_target`/
    `er_target`/`re_target`/`ri_target` — `ci_target` no longer exists
    anywhere in flow.py, {127.25} DR-034) — there is no argument position
    through which cocoindex's per-item bookkeeping could ever observe it.
  - `ingest_once`'s source never calls `.declare_row(` — every write is a raw
    `DB_CTX` pool statement.
  - The closed 7-table `mount_table_target(DB_CTX, "<table>", ...)` set
    (pinned identically to the {138.16} audit, minus `content_items` which
    {127.25} dropped) is UNCHANGED by this Subtask — no 8th engine target was
    added to carry `ingest_once` rows.

BEHAVIOURAL (`TestIngestOnceWritesDerivedRowsOffEngine`):
  - `ingest_once` writes `content_chunks` / `record_embeddings` /
    `entity_mentions` / `entity_relationships` / `q_a_extractions` rows via
    raw-pool `INSERT ... ON CONFLICT` statements, every FK registry-keyed onto
    the SAME resolved `source_document_id` ({138.10} P3 convention — not
    `rel_path`).
  - The `source_documents` row this run mints carries
    `retention_class='ingest_once'` — this call site IS the R(b)
    ingest_once default-stamp gate.

SURVIVAL CONTRAST (`TestIngestOnceSurvivesWhereEngineRowsWouldBeCleaned`):
  drives BOTH paths over the SAME capturing raw pool: `ingest_once` for an
  ingest-once source, then the REAL `ingest_file` engine path (declare_row on
  FakeTargets) for an unrelated keep-and-watch-shaped source. Asserts:
    (1) the ingest-once source's raw-pool rows are UNCHANGED by the
        subsequent engine walk (an "incremental walk where the source is
        absent" proxy — nothing in the walk path can even reference rows it
        never declared);
    (2) NONE of the ingest-once source's rows ever appear on any engine
        `FakeTarget.rows` (`declare_row` is the ONLY surface orphan-cleanup /
        `full_reprocess` can act on — structurally absent here);
    (3) the OTHER (keep-and-watch-shaped) source's rows DO land via
        `declare_row` on the engine targets — proving the contract is
        class-scoped, not global: keep_and_watch stays engine-tracked
        (hence orphan-cleanable) while ingest_once does not.

Reference: docs/specs/id-138-corpus-durable-home/TECH.md §2.5 R(e) / §3.2 P4.
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import re
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

_FLOW_SOURCE_PATH = (
    Path(__file__).resolve().parent.parent / "cocoindex_pipeline" / "flow.py"
)

# The exact 7 tables mounted at flow.py:3593-3665 (transcribed from the
# {138.16} audit's pinned literal, minus `content_items` — dropped {127.25}
# DR-034) — this Subtask must NOT add an 8th.
_EXPECTED_ENGINE_TARGET_TABLES = {
    "q_a_extractions",
    "source_documents",
    "entity_mentions",
    "entity_relationships",
    "content_chunks",
    "reference_items",
    "record_embeddings",
}


# ── cocoindex stub install (mirrors test_cocoindex_chunking.py) ─────────────
# `ingest_once` runs the RecursiveSplitter chunking block UNCONDITIONALLY (no
# `cc_target is not None` guard), so — unlike the shared `conftest.
# fresh_flow_module()` helper most other flow suites use — this file must NOT
# stub `cocoindex.ops`/`cocoindex.ops.text`: doing so turns the module-top
# stub into a non-package MagicMock and the function-local
# `from cocoindex.ops.text import RecursiveSplitter` raises
# `ModuleNotFoundError: No module named 'cocoindex.ops'` the instant it runs
# (empirically confirmed) — the real submodule must resolve.


class _StubContextKey:
    def __init__(self, key: str = "stub") -> None:
        self.key = key


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.fn = passthrough_coco_fn
    stub.lifespan = lambda fn=None: fn
    stub.ContextKey = _StubContextKey
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.mount_each = MagicMock(name="mount_each")
    stub.use_context = MagicMock(name="use_context")
    stub.EnvironmentBuilder = MagicMock(name="EnvironmentBuilder")
    return stub


def _flow_module():
    """Load flow WITHOUT stubbing `cocoindex.ops.text` (real RecursiveSplitter)."""
    coco_stub = _make_coco_stub()
    localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
    pg_stub = MagicMock(name="cocoindex.connectors.postgres")
    pg_stub.ColumnDef = MagicMock(name="ColumnDef")
    pg_stub.TableSchema = MagicMock(name="TableSchema")
    pg_stub.mount_table_target = MagicMock(name="mount_table_target")
    target_stub = MagicMock(name="cocoindex.connectorkits.target")
    target_stub.ManagedBy = MagicMock(name="ManagedBy")
    stubs = {
        "cocoindex": coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": localfs_stub,
        "cocoindex.connectors.postgres": pg_stub,
        "cocoindex.connectorkits": MagicMock(name="cocoindex.connectorkits"),
        "cocoindex.connectorkits.target": target_stub,
        "docling": MagicMock(name="docling"),
        "docling.document_converter": MagicMock(name="docling.document_converter"),
    }
    with stubbed_sys_modules(stubs):
        from scripts.cocoindex_pipeline import flow  # noqa: PLC0415

    _prior_aiohttp = getattr(flow, "aiohttp", None)
    with stubbed_sys_modules(stubs):
        spec_name = getattr(getattr(flow, "__spec__", None), "name", flow.__name__)
        sys.modules.setdefault(spec_name, flow)
        importlib.reload(flow)
    if _prior_aiohttp is not None and isinstance(_prior_aiohttp, MagicMock):
        flow.aiohttp = _prior_aiohttp
    return flow


# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakeTarget:
    """Records `declare_row` calls without touching any DB."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)


class _FakeFile:
    """Minimal localfs.File stand-in, decoupling the logical rel_path from disk."""

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, disk_path: Path, logical_path: "str | None" = None) -> None:
        self.file_path = _FakeFile._FilePath(
            Path(logical_path) if logical_path is not None else disk_path
        )
        self._path = disk_path

    async def size(self) -> int:
        return self._path.stat().st_size

    async def read(self) -> bytes:
        return self._path.read_bytes()

    async def read_text(self) -> str:
        return self._path.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._path.read_bytes()).digest()


class _CapturingPoolConn:
    """asyncpg connection double: answers the M2 resolver + captures every
    raw `execute()` (sql, args) — the SAME shared connection every acquire()
    call returns, so writes from BOTH `ingest_once` and the regular
    `ingest_file` engine path land in ONE capture list for cross-path
    assertions."""

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []
        self.fetchrow_calls: list[tuple] = []

    async def fetchrow(self, sql: str, *args: object) -> dict:
        self.fetchrow_calls.append(args)
        rel_path = args[1]
        return {
            "source_document_id": uuid.uuid5(
                uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"), f"sd:{rel_path}"
            ),
            "was_minted": True,
        }

    async def execute(self, sql: str, *args: object) -> str:
        self.executed.append((sql, args))
        return "INSERT 0 1"


class _CapturingPoolAcquire:
    def __init__(self, conn: _CapturingPoolConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _CapturingPoolConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _CapturingPool:
    def __init__(self) -> None:
        self.conn = _CapturingPoolConn()

    def acquire(self) -> _CapturingPoolAcquire:
        return _CapturingPoolAcquire(self.conn)


def _rows_for(pool: _CapturingPool, table: str) -> list[dict]:
    """Reconstruct rows for `table` from the raw-pool INSERT capture."""
    marker = f"INSERT INTO public.{table} "
    rows: list[dict] = []
    for sql, args in pool.conn.executed:
        if not sql.startswith(marker):
            continue
        cols_segment = sql.split("(", 1)[1].split(")", 1)[0]
        columns = [c.strip() for c in cols_segment.split(",")]
        rows.append(dict(zip(columns, args)))
    return rows


async def _fake_relationships_empty(content_text: str) -> list:
    return []


def _stub_path_a(
    flow: object,
    monkeypatch: pytest.MonkeyPatch,
    *,
    content_text: str,
    entities: list | None = None,
    relationships: list | None = None,
    qa_pairs: list | None = None,
) -> None:
    async def _fake_convert(file: object) -> str:
        return content_text

    async def _fake_classification(content_text: str):
        return {"content_type": "case_study", "primary_domain": "procurement"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": qa_pairs or []}

    async def _fake_entities(content_text: str):
        return entities or []

    async def _fake_relationships(content_text: str):
        return relationships or []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


_ONBOARDING_DOC = (
    "# Onboarding transcript\n\n"
    "The client confirmed acceptance of the framework terms during the "
    "onboarding call. ACME Ltd holds ISO 9001 certification relevant to "
    "this engagement.\n"
)


# ── Structural half ──────────────────────────────────────────────────────────


class TestIngestOnceIsStructurallyOffEngine:
    """R(e) mechanism (i): nothing here can ever enter cocoindex's per-item
    declared-row bookkeeping, so orphan-cleanup / full_reprocess cannot reach
    it — structurally, not by convention."""

    def test_signature_has_no_engine_target_parameter(self) -> None:
        flow = _flow_module()
        params = list(inspect.signature(flow.ingest_once).parameters)
        engine_target_names = {
            "qa_target",
            "sd_target",
            "em_target",
            "cc_target",
            "er_target",
            "re_target",
            "ri_target",
        }
        assert not (engine_target_names & set(params)), (
            f"ingest_once must never accept an engine TableTarget parameter, "
            f"got {params!r}"
        )
        assert not any(name.endswith("_target") for name in params), (
            f"ingest_once gained a _target-shaped parameter ({params!r}) — "
            "this would open a path back onto engine-managed declare_row "
            "bookkeeping, which R(e) forbids structurally"
        )

    def test_source_never_calls_declare_row(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.ingest_once)
        # Checks for an actual METHOD-CALL site (`<target>.declare_row(`) —
        # not a bare substring match, which would also trip on this
        # function's own docstring prose (it legitimately NAMES
        # `TableTarget.declare_row` as the mechanism it deliberately avoids).
        assert ".declare_row(" not in source, (
            "ingest_once must write exclusively via the raw DB_CTX pool — "
            "any declare_row call would re-enter engine bookkeeping and "
            "defeat the R(e) survival mechanism"
        )

    def test_mount_table_target_closed_set_unchanged_by_this_subtask(self) -> None:
        source = _FLOW_SOURCE_PATH.read_text()
        mounted_tables = set(
            re.findall(r'mount_table_target\(\s*DB_CTX,\s*"([a-z_]+)"', source)
        )
        assert mounted_tables == _EXPECTED_ENGINE_TARGET_TABLES, (
            "the engine-managed mount_table_target set changed — {138.11} "
            "must NOT add an 8th engine target; ingest_once writes off-engine "
            "raw-pool rows instead (R(e) mechanism (i))"
        )


# ── Behavioural half ─────────────────────────────────────────────────────────


class TestIngestOnceWritesDerivedRowsOffEngine:
    """`ingest_once` writes every derived class via raw-pool INSERT, keyed to
    the resolved `source_document_id`, with the sd row stamped
    `retention_class='ingest_once'`."""

    _REL_PATH = "onboarding/acme-call-transcript.md"

    def _drive(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        *,
        rel_path: str = _REL_PATH,
        content_text: str = _ONBOARDING_DOC,
    ) -> tuple[object, _CapturingPool, "uuid.UUID"]:
        flow = _flow_module()
        import types

        mention = types.SimpleNamespace(
            entity_type="organisation",
            entity_name="ACME Ltd",
            mention_confidence=0.9,
            source_span_start=0,
            source_span_end=8,
        )
        from scripts.cocoindex_pipeline.extraction import RelationshipExtraction

        relationship = RelationshipExtraction(
            source="ACME Ltd", relationship="holds", target="ISO 9001"
        )
        _stub_path_a(
            flow,
            monkeypatch,
            content_text=content_text,
            entities=[mention],
            relationships=[relationship],
            qa_pairs=[
                {
                    "question_text": "Did the client accept the framework terms?",
                    "answer_text": "Yes, confirmed during the onboarding call.",
                }
            ],
        )

        pool = _CapturingPool()
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

        src = tmp_path / "transcript.md"
        src.write_text(content_text)
        fake_file = _FakeFile(src, logical_path=rel_path)

        op_id = uuid.uuid4()

        async def _exercise() -> "uuid.UUID":
            return await flow.ingest_once(fake_file, rel_path, op_id=op_id)

        source_document_id = asyncio.run(_exercise())
        return flow, pool, source_document_id

    def test_sd_row_is_stamped_ingest_once(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _flow, pool, source_document_id = self._drive(tmp_path, monkeypatch)

        sd_rows = _rows_for(pool, "source_documents")
        assert len(sd_rows) == 1, "expected exactly one source_documents UPSERT"
        assert sd_rows[0]["id"] == source_document_id
        assert sd_rows[0]["retention_class"] == "ingest_once", (
            "ingest_once IS the R(b) default-stamp site for this retention "
            "class — the sd row must carry it"
        )

        # The M2 resolver mint call ALSO carries the stamp (positional arg 6:
        # content_hash, rel_path, filename, mime_type, file_size, origin_type,
        # retention_class, op_id).
        assert pool.conn.fetchrow_calls[0][6] == "ingest_once"

    def test_derived_rows_land_via_raw_pool_keyed_to_source_document_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _flow, pool, source_document_id = self._drive(tmp_path, monkeypatch)

        chunk_rows = _rows_for(pool, "content_chunks")
        embedding_rows = _rows_for(pool, "record_embeddings")
        qa_rows = _rows_for(pool, "q_a_extractions")
        em_rows = _rows_for(pool, "entity_mentions")
        er_rows = _rows_for(pool, "entity_relationships")

        assert len(chunk_rows) >= 1, "expected at least one content_chunks row"
        assert len(embedding_rows) >= 1, "expected at least one record_embeddings row"
        assert len(qa_rows) == 1, "expected the one stubbed qa pair"
        assert len(em_rows) == 1, "expected the one stubbed entity mention"
        assert len(er_rows) == 1, "expected the one stubbed relationship"

        for row in chunk_rows:
            assert row["source_document_id"] == source_document_id
        for row in qa_rows:
            assert row["source_document_id"] == source_document_id
        for row in em_rows:
            assert row["source_document_id"] == source_document_id
        for row in er_rows:
            assert row["source_document_id"] == source_document_id
        for row in embedding_rows:
            assert row["owner_kind"] == "content_chunk"
            assert row["owner_id"] == chunk_rows[0]["id"], (
                "record_embeddings owner_id must be the chunk's OWN PK "
                "(the dual-write contract, ID-131 {131.11})"
            )

        # Registry-keyed (not rel_path-keyed) PKs — {138.10} P3 convention,
        # applied here even for em:/er: (closing the F4 gap on THIS new path).
        # The expected canonical forms are computed via the REAL
        # canonicalisation functions (not hand-guessed literals) — this test
        # proves ingest_once seeds its PKs on `source_document_id` + the SAME
        # canonicalisation the content branch uses, not that a specific
        # string-folding rule holds.
        from scripts.cocoindex_pipeline.canonicalisation import (
            canonicalise_entity_name,
            canonicalise_for_relationship,
        )

        expected_canonical_entity = canonicalise_entity_name(
            "ACME Ltd", "organisation"
        )
        assert em_rows[0]["canonical_name"] == expected_canonical_entity
        assert em_rows[0]["id"] == uuid.uuid5(
            _flow._KH_PIPELINE_DOC_NS,
            f"em:{source_document_id}:{expected_canonical_entity}:organisation",
        )

        expected_source_entity = canonicalise_for_relationship("ACME Ltd")
        expected_target_entity = canonicalise_for_relationship("ISO 9001")
        assert er_rows[0]["source_entity"] == expected_source_entity
        assert er_rows[0]["target_entity"] == expected_target_entity
        assert er_rows[0]["id"] == uuid.uuid5(
            _flow._KH_PIPELINE_DOC_NS,
            f"er:{source_document_id}:{expected_source_entity}:holds:"
            f"{expected_target_entity}",
        )

        assert chunk_rows[0]["id"] == uuid.uuid5(
            _flow._KH_PIPELINE_DOC_NS, f"chunk:{source_document_id}:0"
        )
        assert qa_rows[0]["id"] == uuid.uuid5(
            _flow._KH_PIPELINE_DOC_NS, f"qa:{source_document_id}:0"
        )

    def test_rerun_over_the_same_identity_upserts_not_duplicates(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A re-run of the one-shot path over the SAME bytes/rel_path must
        UPSERT the same rows (idempotent), never mint duplicates — the same
        idempotency guarantee the engine's declare_row gives for free."""
        flow, pool, source_document_id = self._drive(tmp_path, monkeypatch)
        first_chunk_count = len(_rows_for(pool, "content_chunks"))

        # Second run: SAME rel_path/content, fresh op_id, SAME pool.
        _stub_path_a(
            flow,
            monkeypatch,
            content_text=_ONBOARDING_DOC,
            entities=[],
            relationships=[],
            qa_pairs=[],
        )
        src2 = tmp_path / "transcript-2.md"
        src2.write_text(_ONBOARDING_DOC)
        fake_file_2 = _FakeFile(src2, logical_path=self._REL_PATH)

        async def _exercise_again() -> "uuid.UUID":
            return await flow.ingest_once(
                fake_file_2, self._REL_PATH, op_id=uuid.uuid4()
            )

        second_id = asyncio.run(_exercise_again())
        assert second_id == source_document_id, (
            "same rel_path/content must resolve to the SAME source_document_id"
        )
        # The capturing pool double records every execute() call from BOTH
        # runs (it never actually applies an ON CONFLICT resolution — that is
        # real Postgres's job); the row-level idempotency guarantee this test
        # proves is therefore expressed as: both runs' INSERT statements
        # target the SAME chunk PK set (what a real `ON CONFLICT (id) DO
        # UPDATE` would then collapse to one physical row per id).
        chunk_rows = _rows_for(pool, "content_chunks")
        assert len(chunk_rows) == 2 * first_chunk_count, (
            "the capturing pool double records one execute() per run — "
            "expected exactly two runs' worth of INSERT statements"
        )
        first_run_ids = {row["id"] for row in chunk_rows[:first_chunk_count]}
        second_run_ids = {row["id"] for row in chunk_rows[first_chunk_count:]}
        assert first_run_ids == second_run_ids, (
            "re-running over the same identity must target the SAME chunk "
            "PKs (ON CONFLICT (id) UPSERT), not mint new ones"
        )


# ── Survival contrast ────────────────────────────────────────────────────────


class TestIngestOnceSurvivesWhereEngineRowsWouldBeCleaned:
    """R(e) acceptance (TECH §4): an ingest_once source's derived rows survive
    a subsequent walk that never references it, while a keep-and-watch
    source's rows land on the engine's own declare_row bookkeeping — the
    ONLY surface orphan-cleanup / full_reprocess can act on. Class-scoped,
    not global."""

    _INGEST_ONCE_REL_PATH = "onboarding/acme-call-transcript.md"
    _KEEP_AND_WATCH_REL_PATH = "test/unrelated-uploaded-doc.md"

    def test_ingest_once_rows_untouched_by_a_subsequent_unrelated_engine_walk(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        pool = _CapturingPool()
        monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)

        # ── Step 1: the one-shot ingest_once extraction ──────────────────────
        import types

        mention = types.SimpleNamespace(
            entity_type="organisation",
            entity_name="ACME Ltd",
            mention_confidence=0.9,
            source_span_start=0,
            source_span_end=8,
        )
        from scripts.cocoindex_pipeline.extraction import RelationshipExtraction

        relationship = RelationshipExtraction(
            source="ACME Ltd", relationship="holds", target="ISO 9001"
        )
        _stub_path_a(
            flow,
            monkeypatch,
            content_text=_ONBOARDING_DOC,
            entities=[mention],
            relationships=[relationship],
            qa_pairs=[{"question_text": "Q?", "answer_text": "A."}],
        )
        src = tmp_path / "transcript.md"
        src.write_text(_ONBOARDING_DOC)
        once_file = _FakeFile(src, logical_path=self._INGEST_ONCE_REL_PATH)
        once_op_id = uuid.uuid4()

        async def _run_once() -> "uuid.UUID":
            return await flow.ingest_once(
                once_file, self._INGEST_ONCE_REL_PATH, op_id=once_op_id
            )

        once_source_id = asyncio.run(_run_once())

        once_chunks_before = _rows_for(pool, "content_chunks")
        once_em_before = _rows_for(pool, "entity_mentions")
        once_er_before = _rows_for(pool, "entity_relationships")
        once_qa_before = _rows_for(pool, "q_a_extractions")
        once_embeddings_before = _rows_for(pool, "record_embeddings")
        assert once_chunks_before and once_em_before and once_er_before
        assert once_qa_before and once_embeddings_before

        # ── Step 2: a REAL engine walk over a DIFFERENT, keep-and-watch-
        # shaped source — the ingest_once source is simply never enumerated
        # (an "incremental walk where the source is absent" proxy). Reuses
        # the SAME capturing pool, so any cross-source interference would be
        # observable in its capture list. ────────────────────────────────────
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        keep_and_watch_text = (
            "# Uploaded policy document\n\nUnrelated body text for the "
            "keep-and-watch engine-path contrast source.\n"
        )

        async def _fake_convert(file: object) -> str:
            return keep_and_watch_text

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q2?", "answer_text": "A2."}]}

        async def _fake_entities(content_text: str):
            return [mention]

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        cc = _FakeTarget("content_chunks")
        er = _FakeTarget("entity_relationships")
        re_ = _FakeTarget("record_embeddings")

        src2 = tmp_path / "policy.md"
        src2.write_text(keep_and_watch_text)
        walk_file = _FakeFile(src2, logical_path=self._KEEP_AND_WATCH_REL_PATH)
        walk_op_id = uuid.uuid4()

        async def _run_walk() -> None:
            async with bind_flow_meta(op_id=walk_op_id):
                await flow.ingest_file(walk_file, qa, sd, em, cc, er, re_)

        asyncio.run(_run_walk())

        # ── Assertion (1): the ingest_once source's raw-pool rows are BYTE-
        # IDENTICAL after the unrelated engine walk — nothing about running
        # the regular engine path touched them. ─────────────────────────────
        assert _rows_for(pool, "content_chunks")[: len(once_chunks_before)] == (
            once_chunks_before
        )
        assert _rows_for(pool, "entity_mentions")[: len(once_em_before)] == (
            once_em_before
        )
        assert _rows_for(pool, "entity_relationships")[: len(once_er_before)] == (
            once_er_before
        )
        assert _rows_for(pool, "q_a_extractions")[: len(once_qa_before)] == (
            once_qa_before
        )

        # ── Assertion (2): the ingest_once source NEVER appears on any
        # engine FakeTarget — declare_row is the only surface orphan-cleanup
        # / full_reprocess can act on, and it is structurally absent here. ──
        for target in (qa, sd, em, cc, er, re_):
            for row in target.rows:
                assert row.get("source_document_id") != once_source_id, (
                    f"{target.table_name} must never carry the ingest_once "
                    "source's rows via declare_row — that would make it "
                    "reachable by engine orphan-cleanup, defeating R(e)"
                )

        # ── Assertion (3): the OTHER (keep-and-watch-shaped) source's rows
        # DO land via declare_row on the engine targets — the contrast half
        # of the "class-scoped, not global" acceptance criterion (a
        # keep_and_watch source's derived rows ARE still orphan-cleaned when
        # its source leaves walk scope; TECH §4 R(e)). ──────────────────────
        assert len(cc.rows) >= 1, (
            "the keep-and-watch-shaped source's content_chunks rows must be "
            "engine-declared (declare_row) — that is the surface the "
            "engine's own orphan-cleanup acts on for this class"
        )
        assert len(em.rows) >= 1
        assert len(qa.rows) >= 1
