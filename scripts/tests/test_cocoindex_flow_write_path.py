"""Deterministic write-path proof for the reactive declare_row rewrite (ID-28.21/28.22).

Mirrors the RESEARCH.md §R3 live probe (which used a sqlite connector — identical
``declare_row`` / ``mount_table_target`` shape as postgres) but WITHOUT any external
DB, env vars, or the cocoindex Rust engine. The §R3 probe proved the full
App → mount_each → ingest_file → declare_row chain end-to-end against installed
cocoindex 1.0.3; this suite proves the SHAPE deterministically and fast so it runs
anywhere (CI, isolated worktree with no .env.local).

WHAT THIS PROVES (28.21 — declare_row write path):
  - ``ingest_file`` reads a staged file, runs the P-3 adapter + Path A extractors,
    builds the row dicts, and calls ``target.declare_row(row=...)`` on each of the
    three TableTargets.
  - ``op_id`` is stamped as a PLAIN ROW FIELD on every declared row, sourced from
    ``current_flow_meta()`` (FLOW_META_CTX) — NOT via the fictional
    ``bind_target(op_id=flow['op_id'])`` path.
  - ``content_text_hash`` is OMITTED from every row dict (GENERATED ALWAYS column).

WHAT THIS PROVES (28.22 — env-scope DB pool provisioning):
  - A ``@coco.lifespan`` env builder provisions DB_CTX via
    ``EnvironmentBuilder.provide(DB_CTX, pool)`` (single-arg ``use_context`` read
    semantics; no 2-arg ``use_context(key, value)`` async-CM).
  - ``app_main`` contains no fictional dataflow API (no ``.transform()``,
    ``.bind_target()``, ``flow['op_id']``, or 2-arg ``use_context``).

WHAT THIS DOES NOT PROVE (must run on a worktree with .env.local + a postgres target):
  - The real-Supabase end-to-end assertion (28.26): app.update_blocking against a
    staged file, exactly one content_items row, op_id == pipeline_runs.op_id.

Async tests follow the repo convention (no pytest-asyncio plugin): drive coroutines
via ``asyncio.run`` inside sync test functions (see test_cocoindex_app_main_retry_wiring).

Reference: docs/specs/id-28-cocoindex-flow-scaffolding/RESEARCH.md §R1/§R2/§R3/§R6.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sys
import uuid
from pathlib import Path

import pytest


# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.

from conftest import fresh_flow_module  # noqa: E402


# ── cocoindex stub install — centralised in conftest (ID-55.1) ────────────────
# flow.py registers a process-global `coco.App(name="kh_pipeline")` + a
# `@coco.lifespan` + a `coco.ContextKey("kh_pipeline_db")` at import. The real
# cocoindex enforces uniqueness on all three, so importing flow with the REAL
# cocoindex would leak those registrations and break the idle-mode re-import
# contract (test_cocoindex_flow_idle_mode.py) in the combined suite. The shared
# `conftest.fresh_flow_module()` imports flow behind `stubbed_sys_modules` so
# flow captures STUB references for the registration surfaces (no global
# contamination) while `passthrough_coco_fn` keeps `@coco.fn` /
# `@coco.lifespan`-decorated functions real + awaitable.


def _flow_module():
    """Load a fresh stubbed ``cocoindex_pipeline.flow`` (ID-55.1 primitive).

    Replaces this file's former bespoke ``importlib.reload()`` helper. The
    reload form raised ``ImportError: module cocoindex_pipeline.flow not in
    sys.modules`` whenever a sibling test (e.g.
    ``test_cocoindex_flow_entity_mentions_target.py``) had popped the key first
    in a given collection order — the ID-49.7 reload collision. The shared
    ``conftest.fresh_flow_module()`` instead pops BOTH namespace keys and
    re-imports via ``importlib.import_module`` (which re-executes flow.py AND
    re-registers the key, avoiding the stale ``from … import`` package-attribute
    shortcut), and it snapshots/restores the cooperative ``flow.aiohttp`` pin a
    sibling may have set — so this file is now order-stable under any subset.
    """
    return fresh_flow_module()


# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakeTarget:
    """Records ``declare_row`` calls without touching any DB.

    Identical public surface to ``cocoindex.connectors.postgres.TableTarget``
    for the slice under test: a keyword-only ``declare_row(*, row)``.
    """

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []
        self.vector_indexes: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)

    def declare_vector_index(self, **kwargs: object) -> None:
        self.vector_indexes.append(dict(kwargs))


class _FakeFile:
    """Minimal localfs.File stand-in: async ``read`` / ``read_text`` + file_path.

    ``convert_binary_to_markdown`` accesses ``file.file_path.path.suffix`` and calls
    ``await file.read()`` / ``await file.read_text()`` depending on extension, so the
    stand-in mirrors the ``file_path.path`` (FilePath wrapping a Path) shape.

    ``content_fingerprint`` is an ASYNC METHOD returning ``bytes`` — mirrors the
    installed ``cocoindex.resources.file.FileLike.content_fingerprint`` (L172,
    returns ``bytes`` via ``connectorkits.fingerprint.fingerprint_bytes``). The
    production path must ``await`` it and encode to a text-safe string; this
    stand-in lets the test prove that contract without the cocoindex engine.
    """

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, path: Path) -> None:
        self.file_path = _FakeFile._FilePath(path)
        self._path = path

    async def size(self) -> int:
        # cocoindex File.size — the byte length. Used by the content write
        # path for `source_documents.file_size` (NOT NULL). Derived from the
        # staged file so it is honest without the cocoindex engine.
        return self._path.stat().st_size

    async def read(self) -> bytes:
        return self._path.read_bytes()

    async def read_text(self) -> str:
        return self._path.read_text()

    async def content_fingerprint(self) -> bytes:
        # A deterministic digest of the file bytes — the real FileLike returns
        # raw bytes (NOT a hex str), so the production code must encode it.
        import hashlib

        return hashlib.sha256(self._path.read_bytes()).digest()


# ID-101 §{101.7}: a default empty-relationships stub. The content branch now
# awaits `extract_relationships` alongside the other Path-A extractors; every
# write-path test that stubs `extract_entity_mentions` to avoid a live Anthropic
# call must likewise stub `extract_relationships`. The relationship-specific
# write-path proof (`TestIngestFileRelationshipWritePath`) overrides this with a
# non-empty triple list — these other suites only need the seam neutralised.
async def _fake_relationships_empty(content_text: str) -> list:
    return []


# ── S438 raw-pool sd capture (mirrors test_cocoindex_url_write_path.py) ───────
# S437 (id-131) moved the URL sd write off the engine `sd_target` onto a
# raw-pool autocommit UPSERT (`_upsert_source_document`); S438 extends that to
# the localfs content branch. A bare `MagicMock` `coco.use_context` return
# value silently no-ops the write (asyncpg async methods round-trip through
# AsyncMock without raising), so tests that never inspect `sd.rows` content
# stay green either way — but any test asserting on the LANDED sd row must
# stub a real capturing pool and read the row back from it, not from
# `sd_target.rows` (which the content branch no longer populates).


class _FakePoolConn:
    """asyncpg connection double recording ``execute`` calls.

    ID-138 {138.10}: also answers the M2 identity resolver
    (``resolve_or_mint_source_identity``) via ``fetchrow`` — the walk now resolves
    the source_document_id off the raw pool BEFORE the ``_upsert_source_document``
    write. The double mirrors the resolver's MINT formula
    (``uuid5(NS, "sd:"+rel_path)``, keyed on the rel_path arg) so a re-walk of the
    SAME path returns the SAME id (the idempotency these suites assert), exactly
    as the real content_hash-first resolver does on first admission.
    """

    def __init__(self) -> None:
        self.executed: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql: str, *args: object) -> dict:
        # resolver args = (content_hash, rel_path, filename, mime, size, ...)
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


class _FakePoolAcquire:
    def __init__(self, conn: _FakePoolConn) -> None:
        self._conn = conn

    async def __aenter__(self) -> _FakePoolConn:
        return self._conn

    async def __aexit__(self, *exc: object) -> None:
        return None


class _FakePool:
    """asyncpg pool double — ``acquire()`` yields the shared ``_FakePoolConn``."""

    def __init__(self) -> None:
        self.conn = _FakePoolConn()

    def acquire(self) -> _FakePoolAcquire:
        return _FakePoolAcquire(self.conn)


def _wire_pool(flow: object, monkeypatch: pytest.MonkeyPatch) -> "_FakePool":
    """Stub ``coco.use_context`` to return a capturing raw pool.

    Every content-branch test that reads the landed ``source_documents`` row
    needs this — the row now lands via ``_upsert_source_document`` (S437/S438),
    not ``sd_target.declare_row``.
    """
    pool = _FakePool()
    monkeypatch.setattr(flow.coco, "use_context", lambda key: pool)
    return pool


def _sd_upserts_from_pool(pool: "_FakePool") -> list[dict]:
    """Reconstruct source_documents rows from the raw-pool UPSERT capture.

    S438 (id-131 follow-on): the localfs content-branch sd PARENT no longer
    flows through the engine ``sd_target``; it is written by
    ``_upsert_source_document`` as a raw-pool autocommit
    ``INSERT ... ON CONFLICT (id)`` (mirrors
    ``test_cocoindex_url_write_path._sd_upserts_from_pool``, S437). Each
    captured ``source_documents`` INSERT's positional args are mapped back
    onto its column names so assertions read the landed row exactly as they
    did off ``sd_target.declare_row``.
    """
    rows: list[dict] = []
    for sql, args in pool.conn.executed:
        if "INSERT INTO public.source_documents" not in sql:
            continue
        cols_segment = sql.split("(", 1)[1].split(")", 1)[0]
        columns = [c.strip() for c in cols_segment.split(",")]
        rows.append(dict(zip(columns, args)))
    return rows


# ── 28.21 — declare_row write-path shape ──────────────────────────────────────


class TestIngestFileWritePath:
    """``ingest_file`` declares rows on all three targets with op_id stamped."""

    def test_ingest_file_declares_rows_with_op_id_field(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        # Stub the P-3 adapter + Path A extractors so no Docling / anthropic /
        # network is touched — we are proving the WRITE-PATH shape, not extraction.
        markdown = "# Heading\n\nHello world body text."

        async def _fake_convert(file: object) -> str:
            return markdown

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        async def _fake_classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                # ID-64.10 (S296): classifier proposes a human-readable title;
                # lands on source_documents.suggested_title.
                "suggested_title": "Doc One Title",
            }

        async def _fake_qa(content_text: str):
            return {
                "qa_pairs": [
                    # Present-value pair: all 4 ID-54.1 (OQ-52-LOSSY) fields populated.
                    {
                        "question_text": "What is X?",
                        "answer_text": "X is Y.",
                        "expected_response_kind": "mandatory",
                        "evaluation_criteria": "scored on completeness",
                        "evidence_requirements": ["certificate"],
                        "scope_tags": ["lot-1"],
                        # ID-94.1 (G4): alternate phrasings captured at ingest.
                        "question_phrasings": ["What's X?", "Define X.", "Explain X."],
                    },
                    # Default-fallback pair: omits the optional/list fields so the
                    # write-path must supply the Pydantic-equivalent defaults
                    # (None for evaluation_criteria, [] for the list fields incl.
                    # alternate_question_phrasings).
                    {
                        "question_text": "What is Z?",
                        "answer_text": "Z is W.",
                    },
                ]
            }

        async def _fake_entities(content_text: str):
            return []

        # Stage-4 embedding (ID-49.2): stub the embedder seam so no OpenAI call
        # is made — this file proves the declare_row SHAPE, not the embedding.
        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        # Stage one real file so file.read_text() works.
        src = tmp_path / "doc-one.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)
        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                # 4-arg call — mount_each passes fn(File, *extra_args); the key
                # (relative path) is consumed by mount_each for subpath routing
                # and is NOT passed to fn (cocoindex 1.0.3 api.py _mount_one).
                # em_target (3rd extra arg) lands per ID-53.10 §P-4; declare_row
                # body for entity_mentions ships at {53.11}.
                await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # S438 (id-131 follow-on): the sd PARENT lands via the raw-pool UPSERT
        # (`_upsert_source_document`), NOT the engine `sd_target` — reconstruct
        # it from the pool capture (mirrors the URL route, S437).
        sd_rows = _sd_upserts_from_pool(pool)

        # source_documents: exactly one row, op_id stamped, storage_path
        # DERIVED FROM THE FILE (file.file_path.path.as_posix()) — NOT a
        # phantom rel_path param that mount_each would never supply.
        assert len(sd_rows) == 1, "expected one source_documents row"
        assert sd_rows[0]["op_id"] == run_op_id
        assert sd_rows[0]["storage_path"] == src.as_posix(), (
            "storage_path must derive from file.file_path.path, not a param"
        )
        # ID-64.11 (S296): the NOT-NULL source_documents metadata is written —
        # filename (basename), mime_type (suffix-resolved), file_size (bytes) —
        # and content_hash is the prod column (renamed from content_fingerprint,
        # which does not exist in prod).
        assert sd_rows[0]["filename"] == "doc-one.md"
        assert sd_rows[0]["mime_type"] == "text/markdown"
        assert sd_rows[0]["file_size"] == src.stat().st_size
        assert isinstance(sd_rows[0]["content_hash"], str) and sd_rows[0]["content_hash"]
        assert "content_fingerprint" not in sd_rows[0], (
            "content_fingerprint does not exist in prod — must be content_hash"
        )
        # ID-75 BI-4: the localfs branch writes an EXPLICIT source_url None —
        # only URL-sourced documents populate it (the provenance split is
        # visible at the write site).
        assert sd_rows[0]["source_url"] is None, (
            "localfs files have no source URL — explicit None (ID-75 BI-4)"
        )

        # {127.25} DR-034: the content_items row is GONE — the table was
        # dropped and flow.py no longer declares any row onto it (structural
        # INV-5, proved by TestContentItemsIsStructurallyAbsent below). The
        # whole-document embedding that used to ride the content_items row is
        # also gone (DR-036 — no live consumer of a document-level embedding;
        # per-chunk embeddings, asserted elsewhere in this file, are the
        # search substrate and are unaffected).
        #
        # ID-131 {131.22} (G-PRODUCER-CLASS): the classification family
        # (superseding the {63.7}/OQ-63-9 content_items write) lands on
        # source_documents instead.
        assert sd_rows[0]["primary_domain"] == "procurement", (
            "primary_domain must be persisted to source_documents (131.22)"
        )
        assert sd_rows[0]["primary_subtopic"] == "tender_evaluation", (
            "primary_subtopic must be persisted to source_documents (131.22)"
        )
        assert sd_rows[0]["content_type"] == "case_study", (
            "content_type must be persisted to source_documents (131.22)"
        )
        assert sd_rows[0]["suggested_title"] == "Doc One Title", (
            "suggested_title must be persisted to source_documents (131.22)"
        )

        # q_a_extractions: one row per qa_pair, op_id stamped, FK to source_documents.
        assert len(qa.rows) == 2, "expected one q_a_extractions row per qa_pair"
        qa_row = qa.rows[0]
        assert qa_row["op_id"] == run_op_id
        # ID-131 {131.8} M2 (BI-15): q_a_extractions re-parented onto source_documents.
        assert qa_row["source_document_id"] == sd_rows[0]["id"]
        assert qa_row["extracted_question_text"] == "What is X?"
        assert qa_row["extractor_kind"] == "llm_extraction", (
            "extractor_kind must be llm_extraction (OQ-54-E CHECK constraint)"
        )
        # ID-54.1 (OQ-52-LOSSY): the 4 form-question fields the LLM extractor
        # emits were previously dropped at write time. Present-value pair carries
        # all four through declare_row.
        assert qa_row["expected_response_kind"] == "mandatory", (
            "expected_response_kind must reach the q_a_extractions row (OQ-52-LOSSY)"
        )
        assert qa_row["evaluation_criteria"] == "scored on completeness", (
            "evaluation_criteria must reach the q_a_extractions row (OQ-52-LOSSY)"
        )
        assert qa_row["evidence_requirements"] == ["certificate"], (
            "evidence_requirements must reach the q_a_extractions row (OQ-52-LOSSY)"
        )
        assert qa_row["scope_tags"] == ["lot-1"], (
            "scope_tags must reach the q_a_extractions row (OQ-52-LOSSY)"
        )
        # ID-94.1 (G4): alternate phrasings reach the q_a_extractions row as a
        # text[] list, mapped from the QAPair.question_phrasings field.
        assert qa_row["alternate_question_phrasings"] == [
            "What's X?",
            "Define X.",
            "Explain X.",
        ], (
            "question_phrasings must reach q_a_extractions."
            "alternate_question_phrasings (ID-94.1 G4)"
        )
        # Default-fallback pair: omitted fields take the Pydantic-equivalent
        # defaults — None for the optional scalar, [] for the two list columns.
        qa_row_default = qa.rows[1]
        assert qa_row_default["extracted_question_text"] == "What is Z?"
        assert qa_row_default["expected_response_kind"] is None, (
            "expected_response_kind defaults to None when the pair omits it"
        )
        assert qa_row_default["evaluation_criteria"] is None, (
            "evaluation_criteria defaults to None when the pair omits it"
        )
        assert qa_row_default["evidence_requirements"] == [], (
            "evidence_requirements defaults to [] when the pair omits it"
        )
        assert qa_row_default["scope_tags"] == [], (
            "scope_tags defaults to [] when the pair omits it"
        )
        # ID-94.1 (G4): omitted phrasings default to [] (mirrors the DB
        # NOT NULL DEFAULT '{}'), keeping every pair's row insert valid.
        assert qa_row_default["alternate_question_phrasings"] == [], (
            "alternate_question_phrasings defaults to [] when the pair omits it"
        )

    def test_ingest_file_is_exposed_and_callable(self) -> None:
        """``ingest_file`` is a @coco.fn(memo=True) per-item component fn."""
        flow = _flow_module()

        assert hasattr(flow, "ingest_file"), "flow.py must expose ingest_file"
        # Decorated @coco.fn → AsyncFunction; stubbed cocoindex → plain async fn.
        # The robust check is callability (matches the idle-mode test pattern).
        assert callable(flow.ingest_file)


class TestIngestFileStageCounters:
    """ID-55.2 — ``ingest_file`` bumps the per-flow stage counter for the four
    stages that were previously stuck at 0 in production (source_walk /
    binary_conversion / llm_extraction / postgres_upsert), via the same
    ``bind_stage_counter`` substrate ``embedding`` already used.

    Drives one real ``ingest_file`` invocation under a bound
    ``_FlowStageCounter`` and asserts each stage incremented by its per-item
    contract. Targets are the same ``_FakeTarget`` doubles the write-path tests
    use — no DB, no cocoindex engine.
    """

    def test_four_stage_counters_increment_per_item(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_stage_counter,
        )

        markdown = "# Heading\n\nHello world body text."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
            }

        async def _fake_qa(content_text: str):
            return {
                "qa_pairs": [
                    {"question_text": "What is X?", "answer_text": "X is Y."}
                ]
            }

        async def _fake_entities(content_text: str):
            return []  # zero entity rows — em declare_row loop does not run

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-one.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        # The production per-flow counter (NOT a stub) so we exercise the real
        # `_FlowStageCounter.increment(stage)` substrate `app_main` folds.
        counter = flow._FlowStageCounter()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_stage_counter(counter):
                    await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # source_walk / binary_conversion: one per item.
        assert counter.get("source_walk") == 1
        assert counter.get("binary_conversion") == 1
        # llm_extraction: classification + qa_form + entity_mentions +
        # relationships (ID-101 §{101.7} added the fourth Path-A pass).
        assert counter.get("llm_extraction") == 4
        # embedding: this call passes cc_target=None (chunking OFF), so no
        # per-chunk embeddings are produced either. The whole-document
        # embedding that used to unconditionally bump this counter was
        # REMOVED ({127.25} DR-034 — no live consumer, see flow.py Stage 4
        # comment). Chunk-embedding counting is covered by
        # test_cocoindex_chunking.py / test_cocoindex_flow_embedding_stage_
        # count.py (cc_target-bound scenarios), not this cc_target=None slice.
        assert counter.get("embedding") == 0
        # postgres_upsert: one per declare_row/upsert — sd + one qa_pair row
        # (zero entity rows, Path B inactive: no manifest bound). The
        # content_items upsert bump was REMOVED alongside the table
        # ({127.25} DR-034) — was 3 (sd + ci + qa), now 2 (sd + qa).
        assert counter.get("postgres_upsert") == 2

    def test_stage_counters_are_a_silent_noop_without_a_binding(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No `bind_stage_counter` block → `ingest_file` still declares rows;
        only the observability bumps are skipped (graceful degradation)."""
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# H\n\nbody"

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc.md"
        src.write_text(markdown)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            # NO bind_stage_counter — `_bump` must be a no-op.
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), qa, sd, em, None, None)

        asyncio.run(_exercise())  # must not raise

        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        assert len(_sd_upserts_from_pool(pool)) == 1


# ── 28.21 — mount_each → ingest_file arity contract (regression guard) ────────


async def _faithful_mount_each(
    fn: object, items: object, *extra_args: object
) -> None:
    """Faithful stand-in for ``coco.mount_each`` arity semantics (1.0.3).

    Mirrors the INSTALLED cocoindex 1.0.3 contract verified against
    ``cocoindex/_internal/api.py`` ``mount_each`` / ``_mount_one`` (L445-529):
    ``mount_each(fn, items, *extra_args)`` iterates the keyed iterable as
    ``(key, value)`` pairs and calls ``fn(value, *extra_args)`` per item — the
    KEY (relative path) is consumed by mount_each for subpath routing and is
    NEVER passed to ``fn``. This harness reproduces exactly that call shape so
    the test PROVES the real mount_each→fn arity contract, not just the
    function body. A 5-param ``ingest_file(rel_path, file, ...)`` binds
    ``rel_path=<File>`` and leaves ``sd_target`` unbound → TypeError here.
    """
    async for key, value in items:
        # key is intentionally NOT forwarded to fn — matches _mount_one's
        # ``(item, *extra_args)`` call; the key only routes the subpath.
        assert isinstance(key, str), "mount_each keys are relative-path strings"
        await fn(value, *extra_args)  # type: ignore[operator]


class _FakeItemsFeed:
    """Async iterable of ``(relative_path: str, File)`` pairs.

    Mirrors ``localfs.walk_dir(...).items()`` (``_source.py`` L147-161), which
    yields ``(file.file_path.path.relative_to(root).as_posix(), File)``.
    """

    def __init__(self, pairs: list[tuple[str, object]]) -> None:
        self._pairs = pairs

    async def __aiter__(self):  # type: ignore[no-untyped-def]
        for pair in self._pairs:
            yield pair


class TestMountEachArityContract:
    """``ingest_file`` is invoked correctly THROUGH the mount_each contract.

    This is the regression guard that would have caught the ID-28.21 blocker:
    the previous 5-param signature ``ingest_file(rel_path, file, ci, qa, sd)``
    passed CI only because the unit test manually supplied 5 args; the REAL
    mount_each supplies ``fn(File, ci, qa, sd)`` (4 args), so production raised
    TypeError. Per test-philosophy.md, this proves the integration path.
    """

    def test_ingest_file_drives_through_mount_each_over_a_2_file_source(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown_one = "# Doc One\n\nFirst document body."
        markdown_two = "# Doc Two\n\nSecond document body."

        async def _fake_convert(file: object) -> str:
            # Route on the File's own path so each file yields distinct text —
            # exercises that the per-item File (not a phantom param) reaches the
            # adapter. file.file_path.path is the canonical access (adapters.py).
            path = file.file_path.path  # type: ignore[attr-defined]
            return markdown_two if path.name == "doc-two.md" else markdown_one

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        # Stage two real files (so file.read_text() works in the adapter path).
        src_one = tmp_path / "doc-one.md"
        src_one.write_text(markdown_one)
        src_two = tmp_path / "doc-two.md"
        src_two.write_text(markdown_two)
        file_one = _FakeFile(src_one)
        file_two = _FakeFile(src_two)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        er = _FakeTarget("entity_relationships")

        pool = _wire_pool(flow, monkeypatch)
        run_op_id = uuid.uuid4()

        # Keyed feed: (relative_path_str, File) — the key is what mount_each
        # routes on; the value (File) is what reaches ingest_file.
        feed = _FakeItemsFeed(
            [("doc-one.md", file_one), ("doc-two.md", file_two)]
        )

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                # ID-101 §{101.7} (RULING 1): er_target is the LAST extra arg
                # supplied here — thread it through the faithful harness so the
                # full positional arity (qa/sd/em/cc/er) is exercised
                # end-to-end through the real fn(value, *extra_args) contract.
                # ID-136 (forms-route retirement) removed ft_target/ftf_target;
                # {127.25} (DR-034) removed ci.
                await _faithful_mount_each(
                    flow.ingest_file, feed, qa, sd, em, None, er
                )

        asyncio.run(_exercise())

        # S438: the sd rows land via the raw-pool UPSERT, not sd_target.
        sd_rows = _sd_upserts_from_pool(pool)

        # Both files flowed through the 4-arg contract: one sd + one qa row
        # PER source file (2 of each). The content_items row is GONE
        # ({127.25} DR-034).
        assert len(sd_rows) == 2, "expected one source_documents row per file"
        assert len(qa.rows) == 2, "expected one q_a_extractions row per file"

        # Each row carries the run op_id (plain field from current_flow_meta()).
        assert {r["op_id"] for r in sd_rows} == {run_op_id}

        # storage_path derives from EACH File's own path (proves the per-item
        # File reached the body, not a single phantom param).
        assert {r["storage_path"] for r in sd_rows} == {
            src_one.as_posix(),
            src_two.as_posix(),
        }

        # Distinct stable PKs per document (idempotency substrate — uuid5 keyed
        # on the per-document identity, NOT uuid4 which would break Inv-4).
        assert len({r["id"] for r in sd_rows}) == 2

    def test_ingest_file_signature_matches_mount_each_extra_args(self) -> None:
        """``ingest_file`` accepts (file, qa, sd, em, cc=None, er=None, re=None).

        Inspecting the signature directly pins the arity contract: the leading
        parameter is the File item value, followed by the six target extra
        args — and there is NO leading ``rel_path`` parameter (the original
        blocker). This is a real contract guard against the CURRENT
        ``app_main`` ``mount_each`` extra-arg order — not a historical record.

        ID-52.12 originally extended the arity from five to seven by appending
        ``ft_target`` / ``ftf_target`` (the ``form_templates`` /
        ``form_template_fields`` Path-B write targets) after ``em_target``,
        positionally matching the ``coco.mount_each`` extra-arg order in
        ``app_main``. ID-136 (forms-route retirement) REMOVED both — the
        corpus walk no longer writes ``form_templates``; the surviving writer
        is the app-side manual-upload path
        (``app/api/procurement/[id]/forms/route.ts``).

        ID-56.8 appended ``cc_target`` (the ``content_chunks`` chunk-row
        UPSERT target) as a DEFAULTED positional (``cc_target=None``) so
        legacy 5-arg callers stay valid while ``app_main`` always supplies it
        via ``mount_each``.

        ID-101 §{101.7} (RULING 1) appended ``er_target`` (the
        ``entity_relationships`` UPSERT target) as a DEFAULTED positional
        (``er_target=None``) AFTER ``cc_target`` (before the keyword-only
        ``*``) so legacy callers stay valid while ``app_main`` always
        supplies it as the LAST-but-one extra arg in ``mount_each``.

        ID-131 {131.11} appended ``re_target`` (the polymorphic
        ``record_embeddings`` write target) as a DEFAULTED positional
        (``re_target=None``) AFTER ``er_target``, per the RULING 1
        trailing-positional idiom, so ``app_main`` supplies it as the last
        extra arg in ``mount_each`` while legacy callers stay valid.

        {127.25} (DR-034) REMOVED ``ci_target`` (the leading target extra
        arg) — the content_items table is dropped both envs; no live
        consumer of a document-level embedding exists (DR-036 grep-verified).

        ID-66.19 appended KEYWORD-ONLY run-context params (``flow_op_id`` + the
        four counters + ``flow_workspace_manifest``) after a bare ``*`` so
        ``app_main`` can thread the run context via ``functools.partial`` across
        the cocoindex daemon-thread dispatch boundary (ContextVars do not
        propagate to the engine's ``_LoopRunner`` thread). The keyword-only
        additions are invisible to ``mount_each``'s positional
        ``fn(File, *extra_args)`` contract, so this guard inspects the POSITIONAL
        slice only.
        """
        flow = _flow_module()

        sig = inspect.signature(flow.ingest_file)
        positional = [
            name
            for name, p in sig.parameters.items()
            if p.kind
            in (
                inspect.Parameter.POSITIONAL_ONLY,
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
            )
        ]
        assert positional[0] != "rel_path", (
            "ingest_file must NOT lead with rel_path — mount_each passes "
            "fn(File, *extra_args); the key is never forwarded to fn"
        )
        # First positional is the File item value; remaining six are the
        # targets (ID-136 forms-route retirement removed ft_target/ftf_target;
        # {127.25} DR-034 removed ci_target).
        assert len(positional) == 7, (
            f"ingest_file positional params must be exactly "
            f"(file, qa, sd, em, cc, er, re); got {positional}"
        )
        assert positional[-3:] == [
            "cc_target",
            "er_target",
            "re_target",
        ], (
            "the last three positional extra args must be cc_target, "
            f"er_target, re_target (positional order); got {positional}"
        )
        # cc_target is DEFAULTED to None so 5-arg legacy callers stay valid.
        assert sig.parameters["cc_target"].default is None, (
            "cc_target must default to None (the 5-arg callers omit it)"
        )
        # er_target is DEFAULTED to None so 5-/6-arg legacy callers stay valid
        # (ID-101 §{101.7} RULING 1 — defaulted trailing positional).
        assert sig.parameters["er_target"].default is None, (
            "er_target must default to None (the 5-/6-arg callers omit it)"
        )
        # re_target is DEFAULTED to None so 5-/6-/7-arg legacy callers stay
        # valid (ID-131 {131.11} RULING 1 — defaulted trailing positional).
        assert sig.parameters["re_target"].default is None, (
            "re_target must default to None (the 5-/6-/7-arg callers omit it)"
        )


# ── 28.21 — stable run-independent PKs (PRODUCT Inv-4 / OQ-A) ─────────────────


class TestStablePrimaryKeysAcrossRuns:
    """Per-document PKs are deterministic across runs (idempotent UPSERT).

    PRODUCT Inv-4 + ratified OQ-A: re-ingesting the SAME document on a later
    run must UPDATE the same row (re-stamping op_id), NOT insert a duplicate.
    The PK must therefore be a function of the DOCUMENT identity (rel_path)
    ONLY — independent of the per-run op_id. This guard bites against a PK
    seeded with the per-run op_id (which mints a fresh uuid every run, so the
    same document would get a different PK each run → duplicate inserts).
    """

    @staticmethod
    def _ingest_one(
        flow: object,
        fake_file: object,
        run_op_id: uuid.UUID,
        monkeypatch: pytest.MonkeyPatch,
    ) -> dict[str, list[dict]]:
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Stable\n\nSame bytes every run."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        async def _fake_entities(content_text: str):
            return []

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

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)  # type: ignore[attr-defined]

        asyncio.run(_exercise())
        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        return {"qa": qa.rows, "sd": _sd_upserts_from_pool(pool)}

    def test_same_document_two_runs_yields_identical_pks_but_new_op_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        src = tmp_path / "doc-stable.md"
        src.write_text("# Stable\n\nSame bytes every run.")
        fake_file = _FakeFile(src)

        # Two DISTINCT runs (fresh op_id each — as app_main mints run_op_id).
        run_a = uuid.uuid4()
        run_b = uuid.uuid4()
        assert run_a != run_b

        rows_a = self._ingest_one(flow, fake_file, run_a, monkeypatch)
        rows_b = self._ingest_one(flow, fake_file, run_b, monkeypatch)

        # PKs are IDENTICAL across runs (so declare_row UPSERTs the same row).
        assert rows_a["sd"][0]["id"] == rows_b["sd"][0]["id"], (
            "source_documents PK must be stable across runs (Inv-4 idempotency)"
        )
        assert rows_a["qa"][0]["id"] == rows_b["qa"][0]["id"], (
            "q_a_extractions PK must be stable across runs (Inv-4 idempotency)"
        )

        # The op_id ROW FIELD differs — it identifies the RUN, not the PK
        # (ratified OQ-A: full_reprocess re-stamps the same row's op_id).
        assert rows_a["sd"][0]["op_id"] == run_a
        assert rows_b["sd"][0]["op_id"] == run_b
        assert rows_a["sd"][0]["op_id"] != rows_b["sd"][0]["op_id"]


# ── ID-101 §{101.7} — entity_relationships declare-row write path ─────────────


class TestIngestFileRelationshipWritePath:
    """``ingest_file`` declares entity_relationships rows from extracted triples.

    Proves the {101.7} write site (PC-3 lane): the content branch awaits
    ``extract_relationships``, canonicalises both endpoints via
    ``canonicalise_for_relationship``, and declares ONE
    ``entity_relationships`` row per distinct canonical triple onto
    ``er_target`` — with the EXACT legacy TS column set (RULING 2): ``id``,
    ``source_entity``, ``relationship_type``, ``target_entity``,
    ``source_document_id``, ``confidence`` — and NO ``op_id`` / ``created_at``
    (migration-verified absent / PG server default). ``confidence`` is a flat
    ``1.0`` (Inv-16 parity with the TS writer).
    """

    @staticmethod
    def _rel(flow: object, source: str, relationship: str, target: str):
        # Build a real RelationshipExtraction core (the production write site
        # reads .source / .relationship / .target attributes — NOTE the field is
        # `relationship`, NOT `relationship_type`). Using the real Pydantic model
        # keeps the test faithful to the {101.6} extractor output shape.
        from scripts.cocoindex_pipeline.extraction import RelationshipExtraction

        return RelationshipExtraction(
            source=source, relationship=relationship, target=target
        )

    @classmethod
    def _ingest_once(
        cls,
        flow: object,
        triples: list,
        tmp_path: Path,
        run_op_id: "uuid.UUID",
        monkeypatch: pytest.MonkeyPatch,
        *,
        filename: str = "rel-doc.md",
    ):
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Rel\n\nBody for relationship extraction."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_relationships(content_text: str):
            return triples

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / filename
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        er = _FakeTarget("entity_relationships")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                # er_target is the last positional extra arg supplied here
                # (ID-136 removed ft_target/ftf_target; {127.25} removed
                # ci_target; re_target stays defaulted — RULING 1).
                await flow.ingest_file(  # type: ignore[attr-defined]
                    fake_file, qa, sd, em, None, er
                )

        asyncio.run(_exercise())
        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        return er, _sd_upserts_from_pool(pool)

    def test_relationship_rows_match_legacy_column_set(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.canonicalisation import (
            canonicalise_for_relationship,
        )

        run_op_id = uuid.uuid4()
        triples = [
            self._rel(flow, "ACME Ltd", "holds", "ISO 9001"),
            self._rel(flow, "ACME Ltd", "complies_with", "GDPR"),
        ]
        er, sd = self._ingest_once(
            flow, triples, tmp_path, run_op_id, monkeypatch
        )

        assert len(er.rows) == 2, "one entity_relationships row per distinct triple"
        # ID-131 {131.8} M2 (BI-14): entity_relationships re-parented onto
        # source_documents — the FK target is the sd row, not the content_items row.
        # S438: `sd` is the raw-pool UPSERT capture (a list of row dicts), not
        # a `_FakeTarget` — the sd row no longer flows through sd_target.
        source_document_id = sd[0]["id"]

        # Endpoints are canonicalised (lowercase resolve-alias chain), payload is
        # EXACTLY the legacy TS column set — NO op_id, NO created_at (RULING 2).
        expected_keys = {
            "id",
            "source_entity",
            "relationship_type",
            "target_entity",
            "source_document_id",
            "confidence",
        }
        for row in er.rows:
            assert set(row.keys()) == expected_keys, (
                "entity_relationships row must carry EXACTLY the legacy TS "
                f"columns (no op_id / created_at — RULING 2); got {set(row.keys())}"
            )
            assert "op_id" not in row, "op_id is absent from entity_relationships (RULING 2)"
            assert "created_at" not in row, "created_at is a PG server default — omitted"
            assert row["source_document_id"] == source_document_id, (
                "source_document_id must FK the source_documents row this doc produced"
            )
            assert row["confidence"] == 1.0, "confidence is a flat 1.0 (Inv-16 TS parity)"

        first = er.rows[0]
        assert first["source_entity"] == canonicalise_for_relationship("ACME Ltd")
        assert first["relationship_type"] == "holds"
        assert first["target_entity"] == canonicalise_for_relationship("ISO 9001")

    def test_relationship_pk_is_deterministic_on_canonical_triple(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.canonicalisation import (
            canonicalise_for_relationship,
        )

        run_op_id = uuid.uuid4()
        triples = [self._rel(flow, "ACME Ltd", "holds", "ISO 9001")]
        er, _ = self._ingest_once(flow, triples, tmp_path, run_op_id, monkeypatch)

        rel_path = (tmp_path / "rel-doc.md").as_posix()
        # Endpoints are canonicalised via the SAME chain the write site uses —
        # do not hardcode the canonical form (the resolve-alias chain is more
        # than a lowercase).
        source_c = canonicalise_for_relationship("ACME Ltd")
        target_c = canonicalise_for_relationship("ISO 9001")
        expected = uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS,  # type: ignore[attr-defined]
            f"er:{rel_path}:{source_c}:holds:{target_c}",
        )
        assert er.rows[0]["id"] == expected, (
            "entity_relationships PK must be a deterministic uuid5 on the "
            "canonical (rel_path, source, predicate, target) natural key"
        )

    def test_empty_extractor_declares_zero_relationship_rows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        run_op_id = uuid.uuid4()
        er, _ = self._ingest_once(flow, [], tmp_path, run_op_id, monkeypatch)
        assert er.rows == [], "no triples extracted → zero entity_relationships rows"

    def test_duplicate_triples_dedup_per_doc(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        run_op_id = uuid.uuid4()
        # The LLM may emit the same canonical triple twice (e.g. raw-name
        # variants that canonicalise to the same endpoints) — the per-doc dedup
        # collapses them to ONE row keyed on the canonical natural key.
        triples = [
            self._rel(flow, "ACME Ltd", "holds", "ISO 9001"),
            self._rel(flow, "acme ltd", "holds", "iso 9001"),
        ]
        er, _ = self._ingest_once(flow, triples, tmp_path, run_op_id, monkeypatch)
        assert len(er.rows) == 1, "duplicate canonical triples collapse to one row"

    def test_same_doc_two_runs_yields_identical_relationship_pks(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        # Two DISTINCT runs over the SAME document + triples (Inv-4 idempotency):
        # identical PKs so declare_row UPSERTs the same rows, no duplicate inserts.
        run_a = uuid.uuid4()
        run_b = uuid.uuid4()
        assert run_a != run_b
        triples_a = [self._rel(flow, "ACME Ltd", "holds", "ISO 9001")]
        triples_b = [self._rel(flow, "ACME Ltd", "holds", "ISO 9001")]
        er_a, _ = self._ingest_once(flow, triples_a, tmp_path, run_a, monkeypatch)
        er_b, _ = self._ingest_once(flow, triples_b, tmp_path, run_b, monkeypatch)

        assert len(er_a.rows) == 1 and len(er_b.rows) == 1
        assert er_a.rows[0]["id"] == er_b.rows[0]["id"], (
            "entity_relationships PK must be stable across runs (Inv-4 idempotency)"
        )

    def test_out_of_set_predicate_is_skipped_not_crashed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        # Inv-4 (never crash): a triple whose predicate falls outside the 10-set
        # is skipped + logged, the valid triple still lands. The {101.6} Literal
        # normally forbids this at extraction, but the write site guards
        # defensively — bypass Pydantic via a plain-attr stand-in to exercise it.
        class _RawTriple:
            def __init__(self, source: str, relationship: str, target: str) -> None:
                self.source = source
                self.relationship = relationship
                self.target = target

        triples = [
            _RawTriple("ACME Ltd", "not_a_real_predicate", "ISO 9001"),
            _RawTriple("ACME Ltd", "holds", "ISO 9001"),
        ]
        run_op_id = uuid.uuid4()
        er, _ = self._ingest_once(flow, triples, tmp_path, run_op_id, monkeypatch)
        assert len(er.rows) == 1, "out-of-set predicate skipped; valid triple kept"
        assert er.rows[0]["relationship_type"] == "holds"


# ── S438 (id-131 follow-on) — localfs content-branch sd raw-pool FK ordering ──


class TestSourceDocumentRawPoolFkOrdering:
    """S438: extends the S437/id-131 raw-pool sd UPSERT fix to the localfs
    content branch (``_ingest_content_branch``).

    Staging walk f1fd0add: PDF ingestion via the LOCALFS route aborted with an
    asyncpg ``ForeignKeyViolationError`` — an engine-child ``entity_mentions``/
    ``entity_relationships`` INSERT raced the ``source_documents`` parent row.
    Both children were re-parented directly onto ``source_documents`` by
    migration ``20260628200000_id131_extract_reparent.sql`` (M2/BI-14), so the
    SAME INSERT-ordering hazard the URL route hit (S437: an engine-declared
    child flushing before its engine-declared parent, because cocoindex's
    per-target autocommit flush order is uncoordinated —
    cocoindex-write-model.md §2 R1) now also threatens the localfs route. The
    fix mirrors S437 exactly: the sd row is written via the SAME
    ``_upsert_source_document`` raw-pool autocommit UPSERT, synchronously,
    BEFORE any of the engine-declared cc/em/er children (the ``ci`` child
    itself was retired {127.25} DR-034).
    """

    def test_sd_row_lands_via_raw_pool_not_engine_target(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The content-branch sd row no longer flows through ``sd_target`` —
        it lands via the raw-pool capture, with the same BI-4 field contract
        (localfs files carry an explicit ``source_url=None``)."""
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Doc\n\nBody for the FK-ordering proof."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "raw-pool-doc.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        pool = _wire_pool(flow, monkeypatch)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # S438: the engine sd_target NEVER receives a declare_row call — the
        # sd PARENT is committed in-component via the raw pool instead.
        assert sd.rows == [], (
            "the localfs content-branch sd row must no longer flow through "
            "the engine sd_target (S438 raw-pool cutover)"
        )

        sd_rows = _sd_upserts_from_pool(pool)
        assert len(sd_rows) == 1, "expected exactly one raw-pool sd UPSERT"
        sd_row = sd_rows[0]
        assert sd_row["storage_path"] == src.as_posix()
        assert sd_row["op_id"] == run_op_id
        assert sd_row["source_url"] is None, (
            "localfs files have no source URL — explicit None (ID-75 BI-4)"
        )

    def test_sd_raw_pool_write_precedes_entity_children_declares(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Staging walk f1fd0add: the sd raw-pool write must be IN-ORDER
        before BOTH the entity_mentions and entity_relationships declares —
        the exact FK-ordering guarantee S437 gave the URL route (`ri_target`),
        now extended to localfs (BI-14 re-parent)."""
        flow = _flow_module()
        from scripts.cocoindex_pipeline.extraction import RelationshipExtraction
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Doc\n\nACME Ltd holds ISO 9001."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        import types

        mention = types.SimpleNamespace(
            entity_type="certification",
            entity_name="ISO 9001",
            mention_confidence=0.9,
            source_span_start=0,
            source_span_end=9,
        )

        async def _fake_entities(content_text: str):
            return [mention]

        async def _fake_relationships(content_text: str):
            return [
                RelationshipExtraction(
                    source="ACME Ltd", relationship="holds", target="ISO 9001"
                )
            ]

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "ordering-doc.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        order: list[str] = []

        class _OrderedConn:
            async def fetchrow(self, sql: str, *args: object) -> dict:
                # ID-138 {138.10}: the M2 identity resolver — a READ, not a write,
                # so it is NOT recorded in `order` (the FK-ordering guarantee is
                # about the sd write preceding the entity-child declares).
                return {
                    "source_document_id": uuid.uuid5(
                        uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1"),
                        f"sd:{args[1]}",
                    ),
                    "was_minted": True,
                }

            async def execute(self, sql: str, *args: object) -> str:
                if "INSERT INTO public.source_documents" in sql:
                    order.append("sd_upsert")
                return "INSERT 0 1"

        class _OrderedAcquire:
            async def __aenter__(self) -> "_OrderedConn":
                return _OrderedConn()

            async def __aexit__(self, *exc: object) -> None:
                return None

        class _OrderedPool:
            def acquire(self) -> "_OrderedAcquire":
                return _OrderedAcquire()

        monkeypatch.setattr(flow.coco, "use_context", lambda key: _OrderedPool())

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")

        class _OrderingTarget(_FakeTarget):
            def declare_row(self, *, row: dict) -> None:
                order.append(f"{self.table_name}_declare")
                super().declare_row(row=row)

        em = _OrderingTarget("entity_mentions")
        er = _OrderingTarget("entity_relationships")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(
                    fake_file, qa, sd, em, None, er
                )

        asyncio.run(_exercise())

        assert "sd_upsert" in order
        assert "entity_mentions_declare" in order
        assert "entity_relationships_declare" in order
        assert order.index("sd_upsert") < order.index(
            "entity_mentions_declare"
        ), (
            "the sd raw-pool UPSERT must commit BEFORE the entity_mentions "
            "declare (S438 FK-ordering fix, staging walk f1fd0add)"
        )
        assert order.index("sd_upsert") < order.index(
            "entity_relationships_declare"
        ), (
            "the sd raw-pool UPSERT must commit BEFORE the "
            "entity_relationships declare (S438 FK-ordering fix)"
        )


# ── ID-80.10 — Inv-19: Path-A q_a declare payload untouched by form routing ───


class TestInv19QaDeclareSnapshot:
    """Inv-19 — Path-A writes are never touched by form routing (80.2 §Testing
    row 5; ID-80.10).

    Snapshot-compares the content branch's FULL ``q_a_extractions``
    ``declare_row`` payload against a frozen golden literal transcribed from
    the pre-{80.7}/{80.8} refactor declare contract (the per-field shape
    ``TestIngestFileWritePath`` pinned BEFORE the fork landed — ID-54.1 +
    OQ-54-E + the ID-28.21 op_id stamp). Exact ``dict`` equality on the whole
    row list means ANY added, removed, renamed or re-valued key — including a
    drifted ``_KH_PIPELINE_DOC_NS`` (the uuid5 values are hard-coded) — fails
    the snapshot.

    Two modes prove the Inv-19 claim end-to-end through the REAL
    ``ingest_file`` fork body:
      (a) no manifest bound (the Path-A-only default — pre-fork behaviour),
      (b) a mapped ``route:"content"`` manifest (the fork actively resolves
          and routes the content branch).
    Both must produce the IDENTICAL golden payload — the form-routing fork
    must not perturb a single byte of the Path-A q_a declare."""

    _REL_PATH = "acme/inv19-doc.md"
    # Pinned per-run op_id (a literal, not uuid4 — the golden embeds it).
    _OP_ID = uuid.UUID("0b6db886-26be-4c40-bd9f-d44dd5ee1f30")
    # Hard-coded uuid5 values for _KH_PIPELINE_DOC_NS
    # ("fbfaf1ff-1ee4-583c-9757-1674465b2ec1") over the pinned rel_path —
    # computed once and FROZEN so namespace or seed-string drift is caught.
    # ID-131 {131.8} M2 (BI-15): q_a_extractions re-parented onto source_documents,
    # so the golden parent FK is the sd: uuid5 (was the ci: uuid5).
    # ID-138 {138.10} P3: the qa PK re-keys onto the STORED source_document_id
    # (`qa:{sd_id}:{idx}`), NOT `qa:{rel_path}:{idx}` — a rename no longer re-mints
    # the derived row. The frozen literals are recomputed on the new formula.
    _SD_ID = uuid.UUID("f1623a97-eeb2-5462-8589-8d42633b6cb2")  # sd:{rel}
    _QA0_ID = uuid.UUID("b9b73c59-f296-51af-89b5-2b671e11b1c8")  # qa:{sd_id}:0
    _QA1_ID = uuid.UUID("bccdbac5-4559-58b3-af13-7ce57edc6abe")  # qa:{sd_id}:1

    _GOLDEN_QA_ROWS = [
        {
            "id": _QA0_ID,
            "source_document_id": _SD_ID,
            "extractor_kind": "llm_extraction",
            "extracted_question_text": "What is X?",
            "extracted_answer_text": "X is Y.",
            "expected_response_kind": "mandatory",
            "evaluation_criteria": "scored on completeness",
            "evidence_requirements": ["certificate"],
            "scope_tags": ["lot-1"],
            # ID-94.1 (G4): the _fake_qa input omits question_phrasings for both
            # pairs, so the write-path declares the [] default (mirrors the DB
            # NOT NULL DEFAULT '{}'). Frozen into the golden so a future drop or
            # rename of the key fails the Inv-19 snapshot.
            "alternate_question_phrasings": [],
            "extraction_metadata": {
                "extraction_kind": "q_a_form",
                "qa_index": 0,
                "rel_path": "acme/inv19-doc.md",
            },
            "op_id": _OP_ID,
        },
        {
            "id": _QA1_ID,
            "source_document_id": _SD_ID,
            "extractor_kind": "llm_extraction",
            "extracted_question_text": "What is Z?",
            "extracted_answer_text": "Z is W.",
            "expected_response_kind": None,
            "evaluation_criteria": None,
            "evidence_requirements": [],
            "scope_tags": [],
            "alternate_question_phrasings": [],
            "extraction_metadata": {
                "extraction_kind": "q_a_form",
                "qa_index": 1,
                "rel_path": "acme/inv19-doc.md",
            },
            "op_id": _OP_ID,
        },
    ]

    @classmethod
    def _drive(
        cls,
        flow: object,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        *,
        manifest: object | None = None,
    ) -> dict:
        """Drive the REAL ``ingest_file`` with pinned outside-world seams
        (Docling / Anthropic / OpenAI — process boundaries only) and return
        the recording targets."""
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_workspace_manifest,
        )

        markdown = "# Inv-19\n\nFrozen body text."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "Inv-19 Doc",
            }

        async def _fake_qa(content_text: str):
            # The SAME two-pair input the pre-fork write-path contract test
            # used: one fully-populated pair + one defaults-fallback pair.
            return {
                "qa_pairs": [
                    {
                        "question_text": "What is X?",
                        "answer_text": "X is Y.",
                        "expected_response_kind": "mandatory",
                        "evaluation_criteria": "scored on completeness",
                        "evidence_requirements": ["certificate"],
                        "scope_tags": ["lot-1"],
                    },
                    {
                        "question_text": "What is Z?",
                        "answer_text": "Z is W.",
                    },
                ]
            }

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "inv19-doc.md"
        src.write_text(markdown)
        fake_file = _FakeFormFile(cls._REL_PATH, src)

        targets = {
            "qa": _FakeTarget("q_a_extractions"),
            "sd": _FakeTarget("source_documents"),
            "em": _FakeTarget("entity_mentions"),
        }

        # ID-138 {138.10}: the walk now resolves the identity off the raw pool
        # (M2 resolver) before writing — wire a capturing pool so the resolved
        # source_document_id (and the re-keyed qa PKs) are DETERMINISTIC, not a
        # MagicMock. The double mints on the SEED-CONTRACT formula, matching the
        # frozen golden literals.
        _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=cls._OP_ID):
                if manifest is None:
                    await flow.ingest_file(
                        fake_file,
                        targets["qa"],
                        targets["sd"],
                        targets["em"],
                        None,
                        None,
                    )
                else:
                    async with bind_workspace_manifest(manifest):
                        await flow.ingest_file(
                            fake_file,
                            targets["qa"],
                            targets["sd"],
                            targets["em"],
                            None,
                            None,
                        )

        asyncio.run(_exercise())
        return targets

    def test_qa_declare_payload_matches_pre_refactor_golden_no_manifest(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """(a) Path-A-only default (no manifest bound): the q_a declare
        payload is EXACTLY the frozen pre-refactor golden — full-dict
        equality, every key and value."""
        flow = _flow_module()
        out = self._drive(flow, tmp_path, monkeypatch, manifest=None)

        assert out["qa"].rows == self._GOLDEN_QA_ROWS, (
            "the content branch's q_a_extractions declare payload must be "
            "byte-identical to the pre-{80.7}/{80.8} refactor contract "
            "(Inv-19 — 80.2 §Testing row 5)"
        )

    def test_qa_declare_payload_identical_under_content_routed_manifest(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """(b) The fork actively resolves a ``route:"content"`` mapping for
        this file — and the q_a declare payload is STILL the identical
        golden. Form routing never touches a Path-A write."""
        flow = _flow_module()
        ws = uuid.uuid4()
        manifest = _make_manifest(flow, "acme/", ws, route="content")
        out = self._drive(flow, tmp_path, monkeypatch, manifest=manifest)

        assert out["qa"].rows == self._GOLDEN_QA_ROWS, (
            "routing a content file through the {80.8} fork (mapped "
            "route:'content' manifest) must leave the q_a_extractions "
            "declare payload byte-identical to the no-manifest golden "
            "(Inv-19 — Path-A writes never touched by form routing)"
        )
        # ID-136 (forms-route retirement) removed the form_templates /
        # form_template_fields write targets — the "zero form rows either
        # way" assertion this class used to make is now structurally
        # impossible/vacuous and has been removed. The qa/content golden-row
        # assertion above still proves the Inv-19 intent: the content-routed
        # manifest yields the identical qa/content declare payload.


# ── 28.21 — content_fingerprint is awaited (async method, not attribute) ──────


class TestContentFingerprintAwaited:
    """``content_fingerprint`` is read via ``await file.content_fingerprint()``.

    The installed ``FileLike.content_fingerprint`` is an ASYNC METHOD returning
    ``bytes`` (resources/file.py L172). The previous ``getattr(file,
    'content_fingerprint', None)`` captured the bound method object, never the
    value. The production path must await it and encode to a text-safe string
    (the column is ``text``).
    """

    def test_content_fingerprint_is_a_text_digest_not_a_method(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# FP\n\nFingerprint body."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-fp.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        fingerprint = _sd_upserts_from_pool(pool)[0]["content_hash"]
        # Must be a text-safe string (the column is text), NOT a bound method
        # nor a coroutine nor raw bytes.
        assert isinstance(fingerprint, str), (
            "content_fingerprint must be awaited + encoded to a text string, "
            f"not {type(fingerprint).__name__} (the old getattr bug captured "
            "the bound method object)"
        )
        assert fingerprint, "content_fingerprint must be non-empty"

        # It must be the deterministic encoding of the File's awaited digest.
        import hashlib

        expected = hashlib.sha256(markdown.encode()).digest().hex()
        assert fingerprint == expected, (
            "content_fingerprint must encode the awaited bytes digest as hex"
        )


# ── 42.9 — extraction provenance lands on the source_documents write ──────────


class TestSourceDocumentProvenanceWritePath:
    """The recorded source_documents row carries the extraction_method provenance.

    Proves the WIRING SHAPE (ID-42.9 §WP-E): ``ingest_file`` resolves provenance
    via ``extract_source_provenance`` (the real helper, routing by suffix) and
    writes ``extraction_method`` into the declare_row dict. The content_text path
    (Stage 3-6) stays stubbed so this is a pure shape test.

    ID-75 WP-D: the localfs HTML branch is RETIRED — a staged .html/.htm now
    fails LOUDLY per-file (LocalfsHtmlRetiredError); HTML content lands via the
    URL source instead.
    """

    @staticmethod
    def _stub_extractors(flow: object, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    @staticmethod
    def _ingest(
        flow: object, fake_file: object, monkeypatch: pytest.MonkeyPatch
    ) -> list[dict]:
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)  # type: ignore[attr-defined]

        asyncio.run(_exercise())
        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        return _sd_upserts_from_pool(pool)

    def test_html_source_raises_loud_retired_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A staged .html fails LOUDLY (LocalfsHtmlRetiredError).

        ID-75 WP-D: HTML content lands via the URL source; the file corpus does
        not route HTML to the URL extractor (a local file path is unreachable
        for it anyway). The error propagates out of ``ingest_file`` and is
        contained per-file at the mount boundary (ID-80.9) — one bad .html
        never aborts the batch. ZERO rows land on any target.
        """
        flow = _flow_module()
        import sys as _sys

        self._stub_extractors(flow, monkeypatch)

        # convert_binary_to_markdown is NOT stubbed: the REAL adapter routing
        # must raise the named error at Stage 2 — that is the behaviour under
        # test. Resolve the EXACT adapters module flow imported the helpers from
        # (module-identity-agnostic, as the sibling tests do).
        adapters = _sys.modules[flow.extract_source_provenance.__module__]

        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        src = tmp_path / "page.html"
        src.write_text("<html><body>hi</body></html>")
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)  # type: ignore[attr-defined]

        with pytest.raises(adapters.LocalfsHtmlRetiredError):
            asyncio.run(_exercise())

        # The failed file declares ZERO rows on every target.
        assert qa.rows == []
        assert sd.rows == []
        assert em.rows == []

    def test_docling_source_carries_docling_method(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        self._stub_extractors(flow, monkeypatch)

        # PDF routes to docling for provenance; stub the str body so no docling
        # import/conversion is triggered for the content_text path.
        async def _fake_convert(file: object) -> str:
            return "# PDF body"

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        src = tmp_path / "report.pdf"
        src.write_bytes(b"%PDF-1.4 stub")
        sd_rows = self._ingest(flow, _FakeFile(src), monkeypatch)

        assert len(sd_rows) == 1
        assert sd_rows[0]["extraction_method"] == "docling"

    def test_passthrough_source_carries_null_provenance(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        self._stub_extractors(flow, monkeypatch)

        async def _fake_convert(file: object) -> str:
            return "# Markdown body"

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        src = tmp_path / "notes.md"
        src.write_text("# Markdown body")
        sd_rows = self._ingest(flow, _FakeFile(src), monkeypatch)

        assert len(sd_rows) == 1
        assert sd_rows[0]["extraction_method"] is None


# ── 28.21/28.22 — no fictional dataflow API survives ──────────────────────────


class TestNoFictionalApiSurvives:
    """The rewrite removes every fictional 1.0.3 API reference from app_main."""

    def test_app_main_source_has_no_fictional_calls(self) -> None:
        flow = _flow_module()

        src = inspect.getsource(flow.app_main)
        for forbidden in (
            ".bind_target(",
            ".transform(",
            'flow["op_id"]',
            "flow['op_id']",
            "use_context(DB_CTX, ",
        ):
            assert forbidden not in src, (
                f"app_main still references fictional/wrong-arity API: {forbidden!r}"
            )

    def test_app_main_uses_mount_each(self) -> None:
        flow = _flow_module()

        src = inspect.getsource(flow.app_main)
        assert "mount_each(" in src, (
            "app_main must drive the reactive mount_each path"
        )

    def test_no_extract_by_llm_or_llm_spec_anywhere(self) -> None:
        """{101.6} Inv-1 — `cocoindex.ExtractByLlm` / `cocoindex.LlmSpec` are
        ABSENT in cocoindex[postgres]==1.0.7; no extractor (including the new
        `extract_relationships`) may reference them. Survey the whole extraction
        + prompts module source — Path A drives the SDK directly, not the
        fictional ExtractByLlm op.
        """
        from scripts.cocoindex_pipeline import extraction as extraction_mod
        from scripts.cocoindex_pipeline import prompts as prompts_mod

        for module in (extraction_mod, prompts_mod):
            src = inspect.getsource(module)
            for forbidden in ("ExtractByLlm", "LlmSpec"):
                assert forbidden not in src, (
                    f"{module.__name__} still references the fictional "
                    f"cocoindex API {forbidden!r} (absent in 1.0.7; Inv-1)"
                )

        # Belt-and-braces: the new extractor's own source is clean.
        rel_src = inspect.getsource(extraction_mod.extract_relationships)
        assert "ExtractByLlm" not in rel_src and "LlmSpec" not in rel_src, (
            "extract_relationships must not reference ExtractByLlm / LlmSpec"
        )


# ── 28.22 — env-scope DB pool provisioning via @coco.lifespan ─────────────────


class TestLifespanProvidesDbCtx:
    """A @coco.lifespan env builder provides DB_CTX via builder.provide."""

    def test_lifespan_fn_is_registered_and_async(self) -> None:
        flow = _flow_module()

        assert hasattr(flow, "kh_pipeline_lifespan"), (
            "flow.py must expose the @coco.lifespan env builder kh_pipeline_lifespan"
        )
        # The installed env-builder consumes async-generator lifespans natively
        # (LazyEnvironment._get_env: isasyncgenfunction branch). An async-gen
        # lifespan is the correct idiom for an asyncpg pool (the §R2 sketch's
        # run_until_complete-in-a-sync-lifespan would deadlock on the engine loop).
        assert inspect.isasyncgenfunction(flow.kh_pipeline_lifespan), (
            "kh_pipeline_lifespan must be an async generator (asyncpg pool is async)"
        )

    def test_lifespan_provides_db_ctx_and_closes_pool(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        provided: dict[object, object] = {}
        closed = {"value": False}

        class _FakePool:
            async def close(self) -> None:
                closed["value"] = True

            async def fetch(self, query: str, *args: object) -> list:
                # No PIPELINE_CLIENT_ORG set in this test → graceful dev path.
                # Return empty list: _generate_client_alias_snapshot degrades
                # to baseline-only without raising ({101.10} dev/CI branch).
                return []

        class _FakeBuilder:
            def provide(self, key: object, value: object) -> None:
                provided[key] = value

        async def _fake_create_pool(*args: object, **kwargs: object) -> _FakePool:
            return _FakePool()

        # Avoid requiring SUPABASE_* env + a real DB.
        monkeypatch.setattr(flow, "_build_dsn", lambda: "postgresql://stub/db")
        monkeypatch.setattr(flow.asyncpg, "create_pool", _fake_create_pool)

        async def _exercise() -> None:
            gen = flow.kh_pipeline_lifespan(_FakeBuilder())
            await gen.__anext__()  # enter: create pool + provide DB_CTX
            assert flow.DB_CTX in provided, "lifespan must provide DB_CTX env-scope"
            assert isinstance(provided[flow.DB_CTX], _FakePool)

            with pytest.raises(StopAsyncIteration):
                await gen.__anext__()  # exit: close pool
            assert closed["value"] is True, (
                "lifespan must close the pool on teardown"
            )

        asyncio.run(_exercise())


# ── {80.8} shared fixtures — WorkspaceManifest + File stand-in ────────────────
# ID-136 (DR-014): the Path-B form-template write-path classes previously
# anchored here (TestFormWriteSuccessPath, TestFormWriteMemoHitRoundTrip,
# TestFormWriteGracefulEmptyProvenance, TestFormWriteSkipAndFailurePaths,
# TestFormWriteIdempotency) were retired — RouteKind now admits only
# "content"/"qa_sidecar", so route="forms" fails at WorkspaceMapping's
# model_validate. _FakeFormFile and _make_manifest remain: both are shared
# with TestInv19QaDeclareSnapshot above.


class _FakeFormFile:
    """Form-flow File stand-in with a RELATIVE ``file_path.path`` (production
    shape: the localfs path is relative to ``COCOINDEX_SOURCE_PATH``, so
    ``rel_path = file.file_path.path.as_posix()`` is a relative POSIX string the
    manifest prefixes match against). Decouples the logical relative path from
    the on-disk staged file the bytes are read from."""

    class _FilePath:
        def __init__(self, rel_path: Path) -> None:
            self.path = rel_path

    def __init__(self, rel_path: str, disk_path: Path) -> None:
        self.file_path = _FakeFormFile._FilePath(Path(rel_path))
        self._disk = disk_path

    async def size(self) -> int:
        return self._disk.stat().st_size

    async def read(self) -> bytes:
        return self._disk.read_bytes()

    async def read_text(self) -> str:
        return self._disk.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._disk.read_bytes()).digest()


def _make_manifest(
    flow: object, prefix: str, workspace_id: "uuid.UUID", *, route: str = "content"
):
    """Build a real WorkspaceManifest mapping ``prefix`` → ``workspace_id``.

    ID-80.8: the per-prefix ``route`` tag is the fork discriminator (the
    default ``"content"`` keeps every other prefix on Path-A, 80.2 §B.2).
    ID-136 retires the historical ``"forms"`` route — ``route`` now admits
    only ``"content"`` / ``"qa_sidecar"`` (ID-59 {59.26})."""
    from scripts.cocoindex_pipeline.workspace_resolver import (
        WorkspaceManifest,
        WorkspaceMapping,
    )

    return WorkspaceManifest(
        schema_version=1,
        mappings=[
            WorkspaceMapping(
                path_prefix=prefix, workspace_id=workspace_id, route=route
            )
        ],
    )


# ── ID-69 — canonical cross-workspace association ingest invariants ───────────
#
# BL-408 (audit note): `content_item_workspaces` — and `content_items` itself —
# were dropped from the schema at M6 (ID-131.19, migration
# 20260706110000_id131_drops.sql); the cross-referenced
# `__tests__/api/items/workspaces-contract.test.ts` no longer exists either.
# The tests below never queried the real table — `junction` is a plain Python
# `set[tuple[...]]` fixture, not a DB round-trip — so they remain valid as
# pure identity/shape unit tests of flow.py's `declare_row` behaviour
# (BI-1/2/6/8 below); nothing here asserts against a live table. Left in
# place (not deleted) because the identity-stability invariant (BI-6) they
# pin is still architecturally relevant to whatever ingest-side association
# mechanism eventually replaces the junction table.
#
# v1 ships NO ingest-side junction writer (the resolver is single-valued on this
# branch; the multi-workspace carrier is deferred to v1.1). These tests pinned the
# ingest-side PRECONDITIONS that made the (now-removed) operator-side association
# contract safe to reuse unchanged:
#
#   BI-1 — the canonical `content_items` row has NO intrinsic workspace; a record
#          with zero junction rows is still complete.
#   BI-2 — workspace association is NEVER written to `source_documents` (its
#          declared row carries no `workspace_id`); association rode
#          `content_item_workspaces` only.
#   BI-6 — a changed-bytes re-ingest re-stamps the SAME `content_item_id` via the
#          deterministic `uuid5` identity, declaring the parent row as an UPSERT
#          (stable PK) — NOT a delete-and-reinsert, which would FK-cascade every
#          junction row away.
#   BI-8 — association is explicit (operator/manifest), never inferred from
#          folder layout or LLM classification.
#
# Reference (verified S291, NOT modified by these tests; `content_items` and
# `content_item_workspaces` line refs below are HISTORICAL — both tables are
# now dropped, see BL-408 note above): flow.py identity `content_item_id =
# uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")` (:1335); `content_items`
# declare (:1361, no workspace key); `source_documents` declare (:1342, no
# workspace key); FK `content_item_workspaces.content_item_id ->
# content_items.id ON DELETE CASCADE` (migration :5361, squash baseline);
# composite PK :4318.


def _stub_canonical_extractors(
    flow: object, monkeypatch: pytest.MonkeyPatch, *, markdown: str
) -> None:
    """Stub the P-3 adapter + Path A extractors so no Docling / Anthropic /
    OpenAI / network is touched — these ID-69 tests prove the declare-row SHAPE
    and identity discipline, not extraction. Mirrors the established write-path
    stub set; classification returns a domain/subtopic so BI-8 can assert the
    classifier output never becomes a workspace.
    """

    async def _fake_convert(file: object) -> str:
        return markdown

    async def _fake_classification(content_text: str):
        return {
            "content_type": "case_study",
            "primary_domain": "procurement",
            "primary_subtopic": "tender_evaluation",
        }

    async def _fake_qa(content_text: str):
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [0.0] * 1024

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _run_ingest(
    flow: object, fake_file: object, monkeypatch: pytest.MonkeyPatch
) -> list[dict]:
    """Drive one real ``ingest_file`` (no manifest bound → Path A only) and
    return the source_documents raw-pool rows.

    S438 (id-131 follow-on): the localfs content-branch sd PARENT lands via
    the SAME raw-pool autocommit UPSERT the URL route uses (S437) — NOT the
    engine ``sd_target`` — so callers read the sd row from the pool capture
    (``_sd_upserts_from_pool``), not a ``_FakeTarget.rows`` list.

    {127.25} DR-034: this used to also return the content_items
    ``_FakeTarget`` — REMOVED along with the table (the mount + declare_row
    site are both gone; ``source_documents`` is now the sole stable
    per-document identity this helper's callers can key off).
    """
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    pool = _wire_pool(flow, monkeypatch)

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=uuid.uuid4()):
            await flow.ingest_file(fake_file, qa, sd, em, None, None)  # type: ignore[attr-defined]

    asyncio.run(_exercise())
    return _sd_upserts_from_pool(pool)


class TestReingestUpsertPreservesAssociations:
    """{69.6} — BI-6: a changed-bytes re-ingest re-stamps the SAME identity and
    leaves any existing junction associations intact.

    The load-bearing precondition is a deterministic-PK UPSERT (the parent
    ``id`` is stable across re-ingest), NOT a DELETE+INSERT — so a future
    junction FKing onto that parent (ON DELETE CASCADE) never orphans rows.
    This test asserts that discipline; it would fail loudly if the identity
    drifted on re-ingest (the symptom of an accidental delete-and-reinsert).
    No runtime change to flow.py — the guard is a test (TECH Q3).

    {127.25} DR-034: the original BI-6 guard keyed on the (now-dropped)
    ``content_items`` row's ``id``. ``source_documents`` is now the sole
    stable per-document parent identity in the write graph (resolved by the
    {138.10} content-hash-first resolver, mocked deterministically as
    ``uuid5(NS, "sd:"+rel_path)`` by this file's ``_FakePoolConn`` — see
    module docstring), so the BI-6 identity-stability invariant is re-proved
    against it instead; the invariant itself (a stable parent PK survives a
    changed-bytes re-ingest) is unchanged.
    """

    def test_changed_bytes_reingest_restamps_same_source_document_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()

        # Stage one file at a FIXED relative path. The identity is a function of
        # rel_path only (uuid5), so the workspace association keyed on it must
        # survive a content change.
        src = tmp_path / "client-corpus" / "policy.md"
        src.parent.mkdir(parents=True, exist_ok=True)
        src.write_text("# Policy v1\n\nOriginal body text.")

        _stub_canonical_extractors(
            flow, monkeypatch, markdown="# Policy v1\n\nOriginal body text."
        )
        sd_first = _run_ingest(flow, _FakeFile(src), monkeypatch)

        assert len(sd_first) == 1, "expected one source_documents row on ingest"
        source_document_id = sd_first[0]["id"]

        # Simulate the operator (or a future ingest-side writer) associating the
        # canonical record with a workspace — the junction keyed on the parent id.
        workspace_id = uuid.uuid4()
        junction: set[tuple[uuid.UUID, uuid.UUID]] = {
            (source_document_id, workspace_id)
        }

        # Re-ingest the SAME file with CHANGED bytes (a content edit).
        src.write_text("# Policy v2\n\nRevised body text — substantially changed.")
        _stub_canonical_extractors(
            flow,
            monkeypatch,
            markdown="# Policy v2\n\nRevised body text — substantially changed.",
        )
        sd_second = _run_ingest(flow, _FakeFile(src), monkeypatch)

        # (a) Identity is unchanged — uuid5 is a pure function of rel_path.
        assert len(sd_second) == 1
        reingested_id = sd_second[0]["id"]
        assert reingested_id == source_document_id, (
            "re-ingest must re-stamp the SAME source_document_id (deterministic "
            "uuid5 on rel_path) — a drifted id is the symptom of a "
            "delete-and-reinsert that would cascade any future junction away "
            "(BI-6)"
        )

        # (b) The declared row is an UPSERT of the same PK, NOT a new identity:
        #     the changed content rides the SAME id (the raw-pool UPSERT
        #     re-stamps the existing row; op_id is a plain field, not part of
        #     the PK).
        assert sd_second[0]["content_hash"] != sd_first[0]["content_hash"], (
            "the re-ingest carries the changed bytes (content_hash actually "
            "changed)"
        )
        assert sd_second[0]["id"] == sd_first[0]["id"], (
            "the changed content is UPSERTed onto the SAME source_documents "
            "PK (not a delete+insert under a new id)"
        )

        # (c) Because the parent id is stable, the FK-cascade never fires: the
        #     junction association is count-invariant across re-ingest.
        assert (source_document_id, workspace_id) in junction
        assert len(junction) == 1, (
            "a future workspace-junction association must be invariant across "
            "a changed-bytes re-ingest (no FK cascade — BI-6)"
        )

    def test_distinct_files_get_distinct_identities(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Sanity counter-check: two DIFFERENT rel_paths yield DIFFERENT
        source_document_ids, so an association is never silently shared across
        documents (the identity is per-document, keyed on rel_path)."""
        flow = _flow_module()

        a = tmp_path / "corpus" / "doc-a.md"
        b = tmp_path / "corpus" / "doc-b.md"
        a.parent.mkdir(parents=True, exist_ok=True)
        a.write_text("# A\n\nbody a")
        b.write_text("# B\n\nbody b")

        _stub_canonical_extractors(flow, monkeypatch, markdown="# A\n\nbody a")
        sd_a = _run_ingest(flow, _FakeFile(a), monkeypatch)
        _stub_canonical_extractors(flow, monkeypatch, markdown="# B\n\nbody b")
        sd_b = _run_ingest(flow, _FakeFile(b), monkeypatch)

        assert sd_a[0]["id"] != sd_b[0]["id"], (
            "distinct documents must get distinct source_document_ids"
        )


class TestCanonicalRecordHasNoIntrinsicWorkspace:
    """{69.7} — BI-1/BI-2/BI-8: the canonical ingest declares content with no
    intrinsic workspace and never writes a workspace onto source_documents.
    Negative invariants — these assert the ABSENCE of any workspace coupling on
    the canonical (Path A) write path; association rides content_item_workspaces
    only, written explicitly by the operator route (or the deferred v1.1 writer).
    """

    def test_content_items_is_structurally_absent(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """{127.25} DR-034: content_items is RETIRED, not re-pointed — the
        table is dropped both envs (M6) and flow.py declares NO row onto it,
        ever. Replaces the pre-{127.25} shape assertion (a content_items row
        existed, had no workspace column, and carried the full write
        payload) with a structural absence proof: INV-5's "no content_items
        row" guarantee — previously proved only on the qa_sidecar branch
        (see ``_ingest_qa_sidecar_body``'s docstring: "no ci/cc/em/er target
        in its signature") — now holds on EVERY branch, because there is no
        longer a ``ci_target`` parameter anywhere in the ingest call graph
        for content_items rows to reach.
        """
        flow = _flow_module()

        # (a) No content_items TableSchema declaration survives.
        assert not hasattr(flow, "CONTENT_ITEMS_SCHEMA"), (
            "CONTENT_ITEMS_SCHEMA must not exist — content_items is dropped "
            "both envs ({127.25} DR-034)"
        )

        # (b) No function in the ingest call graph accepts a ci_target — the
        # only way a `declare_row` call could ever reach a content_items row.
        for fn_name in ("ingest_file", "_ingest_file_body", "_ingest_content_branch"):
            params = set(inspect.signature(getattr(flow, fn_name)).parameters)
            assert "ci_target" not in params, (
                f"{fn_name} must not accept ci_target — the content_items "
                "write was removed ({127.25} DR-034)"
            )

        # (c) Source-inspection: `ci_target` (the only handle a declare_row
        # call for content_items could use) does not appear anywhere in the
        # content-branch write body, mirroring this codebase's established
        # `.declare_row(` absence-proof idiom (test_cocoindex_ingest_once.py
        # ``test_source_never_calls_declare_row``).
        branch_source = inspect.getsource(flow._ingest_content_branch)
        assert "ci_target" not in branch_source, (
            "_ingest_content_branch must never reference ci_target — a "
            "content_items declare_row call is structurally impossible "
            "({127.25} DR-034)"
        )

        # (d) Empirical: driving a real ingest still lands exactly one
        # complete source_documents row (6-arg target tuple — ci mock
        # dropped; qa/sd/em/cc/er/re, per the new ingest_file arity).
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")
        sd = _run_ingest(flow, _FakeFile(src), monkeypatch)
        assert len(sd) == 1, "expected exactly one source_documents row"

    def test_source_documents_row_never_carries_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")

        sd = _run_ingest(flow, _FakeFile(src), monkeypatch)

        # BI-2: the source_documents provenance row carries no workspace — the
        # canonical-path equivalent of `source_documents.workspace_id IS NULL`.
        # S438: `sd` is the raw-pool UPSERT capture (a list of row dicts).
        sd_row = sd[0]
        assert "workspace_id" not in sd_row, (
            "source_documents must NEVER carry a workspace (BI-2) — workspace "
            "association is written ONLY via a future explicit-association "
            "mechanism, never inline on the canonical write path"
        )

    def test_classification_output_is_never_a_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """BI-8: the LLM classification (primary_domain / primary_subtopic) is
        persisted to source_documents (ID-131 {131.22} G-PRODUCER-CLASS
        re-homed the write off content_items, which no longer exists —
        {127.25} DR-034) but is NEVER interpreted as a workspace. Association
        is explicit, never inferred from classification."""
        flow = _flow_module()
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")

        sd = _run_ingest(flow, _FakeFile(src), monkeypatch)
        sd_row = sd[0]

        # The classifier output landed on source_documents' own columns…
        assert sd_row["primary_domain"] == "procurement"
        assert sd_row["primary_subtopic"] == "tender_evaluation"
        # …and it never carries the value in a workspace field (no
        # classification->workspace mapping exists on the canonical path —
        # BI-8).
        assert "workspace_id" not in sd_row
        assert sd_row.get("primary_domain") != sd_row.get("workspace_id")


# ── 66.16 — stamp_extraction_base is WIRED into the per-item path (Inv-5) ──────


class TestStampExtractionBaseWiredIntoIngest:
    """PRODUCT Inv-5 [RATIFIED-S241]: every extraction variant carries op_id,
    source_document_id, and extracted_at — populated by the outer-tier cocoindex
    flow wrapper, NOT by the LLM.

    Before {66.16} stamp-wiring, ``flow.py`` imported ``stamp_extraction_base``
    but NEVER invoked it on the per-item write path: the extraction objects sat
    at the ``_UNSTAMPED_*`` sentinel placeholders while rows were written with
    the flow-level ``op_id`` directly. This suite proves the import is no longer
    vestigial — each of classification / qa_form / entity_mention IS stamped with
    the flow-scope ``op_id`` + the row's deterministic ``content_item_id`` via
    EXPLICIT kwargs (NOT the FLOW_META_CTX binding, which does not cross the
    cocoindex ``_LoopRunner`` daemon-thread boundary — {66.19}/S294).

    BEHAVIOUR-PRESERVING: the stamped object ``op_id`` MUST equal the flow-level
    ``op_id`` already written to the rows — the row writes are unchanged.
    """

    @staticmethod
    def _stub_pydantic_extractors(
        flow: object, monkeypatch: pytest.MonkeyPatch, markdown: str
    ) -> None:
        """Stub the extractors to return REAL Pydantic CORE variants (NOT dicts).

        bl-220 / ID-74: the memo extractors return the stamp-FREE core types, so
        this stub feeds genuine cores — `_stamp_if_model` → `stamp_extraction_base`
        CONSTRUCTS the matching `*Stamped` type from each core (the sibling
        write-path tests feed plain dicts, which the wiring leaves untouched —
        proved by ``test_dict_returning_extractors_are_not_stamped``). Each core
        carries NO stamp fields by construction, so the post-stamp assertions prove
        the stamp constructed them from the resolved flow values.
        """
        from scripts.cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            EntityMentionExtraction,
            FormMetadata,
            QAFormExtraction,
            QAPair,
        )

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return ClassificationExtraction(
                content_type="document",
                primary_domain="procurement",
                primary_subtopic="tender_evaluation",
                classification_confidence=0.9,
            )

        async def _fake_qa(content_text: str):
            return QAFormExtraction(
                form_metadata=FormMetadata(form_type="tender", form_format="pdf"),
                qa_pairs=[
                    QAPair(
                        question_text="What is X?",
                        answer_text="X is Y.",
                        expected_response_kind="mandatory",
                    )
                ],
            )

        async def _fake_entities(content_text: str):
            # Two mentions so the per-mention stamp is proved to run for EACH.
            return [
                EntityMentionExtraction(
                    entity_type="organisation",
                    entity_name="Acme Council",
                    source_span_start=0,
                    source_span_end=12,
                    mention_confidence=0.95,
                ),
                EntityMentionExtraction(
                    entity_type="framework",
                    entity_name="MEAT",
                    source_span_start=13,
                    source_span_end=17,
                    mention_confidence=0.8,
                ),
            ]

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    @staticmethod
    def _spy_stamp(flow: object, monkeypatch: pytest.MonkeyPatch) -> list:
        """Record every ``stamp_extraction_base`` call, delegating to the real
        implementation so the returned (stamped) object is the genuine article.

        Records ``(input_obj, kwargs, stamped_obj)`` triples so tests can assert
        BOTH the invocation (input was a sentinel-bearing model) AND the result
        (stamped with the flow op_id + content_item_id).
        """
        real_stamp = flow.stamp_extraction_base
        calls: list = []

        def _spy(extraction, **kwargs):  # type: ignore[no-untyped-def]
            stamped = real_stamp(extraction, **kwargs)
            calls.append((extraction, dict(kwargs), stamped))
            return stamped

        monkeypatch.setattr(flow, "stamp_extraction_base", _spy)
        return calls

    def test_each_extraction_object_is_stamped_with_flow_op_id_and_source_document_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from scripts.cocoindex_pipeline.extraction import _UNSTAMPED_AT
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "Acme Council MEAT evaluation case study body."
        self._stub_pydantic_extractors(flow, monkeypatch, markdown)
        calls = self._spy_stamp(flow, monkeypatch)

        src = tmp_path / "doc-stamp.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)
        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # ID-131 {131.8} Part C: the stamp carries the row's deterministic
        # source_document_id (sd: uuid5), seeded on rel_path — the canonical
        # record identity post-re-parent (was the ci: uuid5; content_items
        # itself is gone entirely — {127.25} DR-034).
        rel_path = src.as_posix()
        expected_source_document_id = uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"sd:{rel_path}"
        )

        # stamp_extraction_base ran for classification + qa_form + each of the
        # two entity mentions → 4 invocations (the import is no longer dead).
        assert len(calls) == 4, (
            "stamp_extraction_base must be invoked once per extraction object "
            f"(classification + qa_form + 2 mentions); got {len(calls)} calls"
        )

        for input_obj, kwargs, stamped in calls:
            # Invoked with EXPLICIT kwargs (NOT relying on FLOW_META_CTX, which
            # cannot cross the daemon-thread boundary — {66.19}).
            assert kwargs.get("op_id") == run_op_id, (
                "stamp must be called with the explicit flow op_id kwarg"
            )
            assert kwargs.get("source_document_id") == expected_source_document_id, (
                "stamp must be called with the explicit row source_document_id kwarg"
            )
            # bl-220 / ID-74: the INPUT is the stamp-FREE core the memo extractor
            # returns — it carries NO stamp fields (they must not cross the memo
            # boundary). The stamp is therefore a genuine CONSTRUCT-from-core, not
            # a sentinel overwrite.
            assert not hasattr(input_obj, "op_id")
            assert not hasattr(input_obj, "source_document_id")
            assert not hasattr(input_obj, "extracted_at")
            # The RESULT (the *Stamped* type) carries the flow op_id + the row's
            # source_document_id and a real (post-sentinel) extracted_at — Inv-5 is
            # satisfied on the object the row writers read.
            assert stamped.op_id == run_op_id
            assert stamped.source_document_id == expected_source_document_id
            assert stamped.extracted_at > _UNSTAMPED_AT

        # BEHAVIOUR-PRESERVING: the stamped object op_id EQUALS the flow op_id
        # already written to every row (the row writes are unchanged).
        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        assert _sd_upserts_from_pool(pool)[0]["op_id"] == run_op_id
        assert {row["op_id"] for row in qa.rows} == {run_op_id}
        assert {row["op_id"] for row in em.rows} == {run_op_id}
        # The two entity rows still landed (the per-mention stamp did not disturb
        # the declare_row loop).
        assert len(em.rows) == 2

    def test_dict_returning_extractors_are_not_stamped(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The stamp wiring is a no-op for the plain-dict test stubs.

        ``stamp_extraction_base`` constructs the stamped type from a Pydantic
        core (it reads ``model_dump``) — passing a dict would not have that
        method, so the ``_stamp_if_model`` guard passes dicts straight through.
        The wiring must therefore stamp ONLY genuine extraction-core instances,
        leaving the dict-returning sibling stubs (and any future dict caller)
        untouched. Proves the wiring did not break the existing dict-based
        write-path harness.
        """
        flow = _flow_module()
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# H\n\nbody"

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study", "primary_domain": "procurement"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        async def _fake_entities(content_text: str):
            return []

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        calls = self._spy_stamp(flow, monkeypatch)

        src = tmp_path / "doc-dict.md"
        src.write_text(markdown)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), qa, sd, em, None, None)

        asyncio.run(_exercise())  # must not raise (no model_dump on a dict)

        assert calls == [], (
            "stamp_extraction_base must NOT be called for plain-dict extractor "
            "outputs — only genuine extraction-core instances are stamped"
        )
        # Rows still landed normally. S438: sd lands via the raw-pool UPSERT.
        assert len(_sd_upserts_from_pool(pool)) == 1 and len(qa.rows) == 1


# ── {66.22}/{66.23} (S297) — workspace rel_path + manifest-skip fixes ─────────
# FAITHFUL to the prod reality the mocked suite previously masked: cocoindex's
# `file.file_path.path` is ABSOLUTE in production, and the workspace manifest is
# enumerated by walk_dir as an item. The pre-existing write-path tests pass a
# tmp_path file but NO manifest, so they never exercised `resolve_workspace`
# (BUG-A) and stub `convert_binary_to_markdown` so a '.json' never raised (BUG-B).


class TestWorkspacePathFixes:
    """{66.22} source-relative rel_path + {66.23} manifest-skip (S297)."""

    def test_to_source_relative_strips_source_root(self) -> None:
        """{66.22}: the helper normalises an ABSOLUTE prod path to source-relative."""
        flow = _flow_module()
        source_root = Path("/cocoindex-state/corpus")
        # Absolute path under the source root → source-relative POSIX string.
        assert (
            flow._to_source_relative(
                Path("/cocoindex-state/corpus/test/x.md"), source_root
            )
            == "test/x.md"
        )
        # source_path None (in-task unit-test / legacy callers) → plain as_posix.
        assert (
            flow._to_source_relative(Path("/cocoindex-state/corpus/test/x.md"), None)
            == "/cocoindex-state/corpus/test/x.md"
        )
        # Path NOT under source_root → fallback to as_posix (no ValueError leak).
        assert flow._to_source_relative(Path("/other/y.md"), source_root) == "/other/y.md"
        # An already-relative path is returned unchanged.
        assert (
            flow._to_source_relative(Path("test/x.md"), source_root) == "test/x.md"
        )

    def test_ingest_file_rel_path_is_source_relative_and_resolves_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """{66.22}/BUG-A: an ABSOLUTE file path under the source root resolves a
        RELATIVE-prefixed manifest, and storage_path lands source-relative.

        Pre-fix RED: rel_path = file.file_path.path.as_posix() is the ABSOLUTE
        prod path, so (1) storage_path is absolute and (2) resolve_workspace
        raises ResolutionFailure ('test/'-prefix never matches the absolute
        path) → a workspace_resolution stage error is emitted.
        """
        flow = _flow_module()
        from scripts.cocoindex_pipeline.workspace_resolver import (
            WorkspaceManifest,
            WorkspaceMapping,
        )

        markdown = "# Heading\n\nBody text."

        async def _conv(file: object) -> str:
            return markdown

        async def _cls(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "Doc Title",
            }

        async def _qa(content_text: str):
            return {"qa_pairs": []}

        async def _ent(content_text: str):
            return []

        async def _emb(content_text: str):
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _conv)
        monkeypatch.setattr(flow, "extract_classification", _cls)
        monkeypatch.setattr(flow, "extract_qa_form", _qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _ent)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _emb)
        # ID-136 (forms-route retirement) removed extract_form_structure and
        # the Path-B form block entirely — the content path below no longer
        # calls it, so there is nothing left to monkeypatch here.

        stage_errors: list[dict] = []

        def _capture_stage_error(**kwargs: object) -> None:
            stage_errors.append(kwargs)

        monkeypatch.setattr(flow, "_emit_stage_error_log", _capture_stage_error)

        # ABSOLUTE file path under a source root (the prod shape), mapped via a
        # source-RELATIVE manifest prefix.
        source_root = tmp_path / "corpus"
        (source_root / "test").mkdir(parents=True)
        src = source_root / "test" / "doc.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ws = uuid.UUID("b0000000-0000-4000-8000-000000000001")
        manifest = WorkspaceManifest(
            schema_version=1,
            mappings=[WorkspaceMapping(path_prefix="test/", workspace_id=ws)],
        )

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        pool = _wire_pool(flow, monkeypatch)

        async def _exercise() -> None:
            await flow.ingest_file(
                fake_file,
                qa,
                sd,
                em,
                None,
                None,
                None,
                flow_op_id=uuid.uuid4(),
                flow_workspace_manifest=manifest,
                flow_source_path=source_root,
            )

        asyncio.run(_exercise())

        # S438: the sd row lands via the raw-pool UPSERT, not sd_target.
        sd_rows = _sd_upserts_from_pool(pool)

        # BUG-A: storage_path is the SOURCE-RELATIVE POSIX string, NOT the
        # absolute prod path. (Also the seed of the deterministic uuid5 PKs.)
        assert sd_rows[0]["storage_path"] == "test/doc.md", (
            "storage_path must be source-relative (the manifest prefix matches "
            "the relative form, not the absolute prod path)"
        )
        # Content lands independently of workspace resolution (ID-69 BI-1).
        assert len(sd_rows) == 1
        # resolve_workspace SUCCEEDED — no workspace_resolution stage error.
        assert [e for e in stage_errors if e.get("stage") == "workspace_resolution"] == [], (
            "resolve_workspace must succeed against the source-relative rel_path "
            "(the absolute path would raise ResolutionFailure on the 'test/' prefix)"
        )

    def test_workspace_manifest_file_is_skipped_not_ingested(
        self, tmp_path: Path
    ) -> None:
        """{66.23}/BUG-B: the manifest file is skipped before conversion.

        Pre-fix RED: with no skip guard, ingest_file calls the REAL
        convert_binary_to_markdown on a '.json' suffix → ValueError
        'Unsupported file extension'. The fix short-circuits before conversion.
        convert_binary_to_markdown is intentionally NOT stubbed here.
        """
        flow = _flow_module()

        src = tmp_path / ".kh-workspace-map.json"
        src.write_text('{"schema_version": 1, "mappings": []}')
        fake_file = _FakeFile(src)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        cc = _FakeTarget("content_chunks")
        er = _FakeTarget("entity_relationships")

        async def _exercise() -> None:
            await flow.ingest_file(
                fake_file,
                qa,
                sd,
                em,
                cc,
                er,
                None,
                flow_op_id=uuid.uuid4(),
            )

        # Must NOT raise (the pre-fix path raises ValueError on the .json suffix).
        asyncio.run(_exercise())

        # The manifest is not content → no rows declared on any target.
        assert sd.rows == [] and qa.rows == [] and em.rows == []
        assert cc.rows == [] and er.rows == []

    def test_register_pg_codecs_serialises_jsonb_dict(self) -> None:
        """{66.16}/BUG-D (S297): the pool init hook registers a jsonb codec whose
        encoder turns a Python dict into a JSON string.

        cocoindex's USER-managed row-upsert passes raw declare_row values to
        asyncpg with no per-column encoder, so a dict jsonb value (e.g.
        entity_mentions.metadata) would raise DataError 'expected str, got dict'.
        The codec encoder must produce a str.
        """
        import json

        flow = _flow_module()

        calls: list[tuple] = []

        class _FakeConn:
            async def set_type_codec(self, name: str, **kw: object) -> None:
                calls.append((name, kw))

        asyncio.run(flow._register_pg_codecs(_FakeConn()))

        assert len(calls) == 1, "exactly one codec registered"
        name, kw = calls[0]
        assert name == "jsonb"
        assert kw["schema"] == "pg_catalog"
        # The encoder must serialise a dict -> str (the BUG-D fix).
        encoded = kw["encoder"]({"source_span_start": 2, "source_span_end": 9})
        assert isinstance(encoded, str)
        assert json.loads(encoded) == {"source_span_start": 2, "source_span_end": 9}
        # default=str guards non-JSON-native values (UUID / datetime).
        guarded = kw["encoder"]({"id": uuid.uuid4()})
        assert isinstance(guarded, str)
        # Decoder round-trips.
        assert kw["decoder"]('{"a": 1}') == {"a": 1}

    def test_entity_mentions_dedup_by_canonical_type(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """{66.16}/BUG-F (S297): duplicate (canonical, type) entity mentions
        collapse to ONE entity_mentions row.

        Prod enforces UNIQUE (canonical_name, entity_type, source_document_id). The
        old em:{rel_path}:{idx} PK declared one row PER raw mention, so two
        mentions of the same entity produced two rows with distinct ids that the
        cocoindex ON CONFLICT (id) upsert did not absorb -> UniqueViolationError.
        The dedup + natural-key PK collapses them.
        """
        import types

        flow = _flow_module()
        markdown = "# Doc\n\nAcme Ltd, and Acme Ltd again."

        async def _conv(file: object) -> str:
            return markdown

        async def _cls(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "T",
            }

        async def _qa(content_text: str):
            return {"qa_pairs": []}

        def _mention(name: str, conf: float):
            return types.SimpleNamespace(
                entity_name=name,
                entity_type="company",
                mention_confidence=conf,
                source_span_start=0,
                source_span_end=8,
            )

        # Two mentions of the SAME entity (same name + type) -> same canonical.
        async def _ent(content_text: str):
            return [_mention("Acme Ltd", 0.7), _mention("Acme Ltd", 0.9)]

        async def _emb(content_text: str):
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _conv)
        monkeypatch.setattr(flow, "extract_classification", _cls)
        monkeypatch.setattr(flow, "extract_qa_form", _qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _ent)
        monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
        monkeypatch.setattr(flow, "embed_content_text", _emb)

        src = tmp_path / "doc.md"
        src.write_text(markdown)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        asyncio.run(_exercise())

        # BUG-F: the two duplicate mentions collapse to exactly ONE row.
        assert len(em.rows) == 1, (
            f"expected 1 deduped entity_mentions row, got {len(em.rows)}"
        )
        assert em.rows[0]["entity_type"] == "company"
        # The higher-confidence mention is the one kept.
        assert em.rows[0]["confidence"] == 0.9


# ── ID-101 §{101.8} — holder-rule stamp wiring in the em-declare loop ─────────
# Proves derive_holder_metadata is wired into the em loop so a cert mention's
# metadata carries BOTH the span keys AND the merged holder keys, that no-signal
# certs stay span-only (Inv-10), and that an unset PIPELINE_CLIENT_ORG degrades
# via the Inv-15 logged-fallback path (span-only metadata, doc still ingests).
class TestHolderStampWiring:
    """The em-declare loop merges holder metadata over the span metadata."""

    @staticmethod
    def _stub_with_mentions_and_rels(
        flow: object,
        monkeypatch: pytest.MonkeyPatch,
        markdown: str,
        mentions: list,
        relationships: list,
    ) -> None:
        async def _conv(file: object) -> str:
            return markdown

        async def _cls(content_text: str):
            return {
                "content_type": "case_study",
                "primary_domain": "procurement",
                "primary_subtopic": "tender_evaluation",
                "suggested_title": "T",
            }

        async def _qa(content_text: str):
            return {"qa_pairs": []}

        async def _ent(content_text: str):
            return mentions

        async def _rel(content_text: str):
            return relationships

        async def _emb(content_text: str):
            return [0.0] * 1024

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _conv)
        monkeypatch.setattr(flow, "extract_classification", _cls)
        monkeypatch.setattr(flow, "extract_qa_form", _qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _ent)
        monkeypatch.setattr(flow, "extract_relationships", _rel)
        monkeypatch.setattr(flow, "embed_content_text", _emb)

    @staticmethod
    def _mention(name: str, entity_type: str, *, start: int, end: int):
        import types

        return types.SimpleNamespace(
            entity_name=name,
            entity_type=entity_type,
            mention_confidence=0.9,
            source_span_start=start,
            source_span_end=end,
        )

    @staticmethod
    def _rel(source: str, relationship: str, target: str):
        import types

        return types.SimpleNamespace(
            source=source, relationship=relationship, target=target
        )

    def _row_for(self, em: object, entity_type: str) -> dict:
        rows = [r for r in em.rows if r["entity_type"] == entity_type]
        assert len(rows) == 1, f"expected one {entity_type} row, got {len(rows)}"
        return rows[0]

    def test_cert_metadata_merges_span_and_holder_keys(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A holds rel from the client org stamps holder:self ALONGSIDE span keys."""
        flow = _flow_module()
        # PIPELINE_CLIENT_ORG resolves the self-vs-supplier split.
        monkeypatch.setenv("PIPELINE_CLIENT_ORG", "Knowledge Hub Ltd")
        markdown = "# Doc\n\nKnowledge Hub Ltd holds ISO 27001."

        mentions = [
            self._mention("ISO 27001", "certification", start=2, end=11),
            self._mention("Knowledge Hub Ltd", "organisation", start=20, end=37),
        ]
        rels = [self._rel("Knowledge Hub Ltd", "holds", "ISO 27001")]
        self._stub_with_mentions_and_rels(flow, monkeypatch, markdown, mentions, rels)

        src = tmp_path / "doc.md"
        src.write_text(markdown)

        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        asyncio.run(_exercise())

        cert = self._row_for(em, "certification")
        # Span keys PRESERVED + holder keys MERGED (not overwritten).
        assert cert["metadata"] == {
            "source_span_start": 2,
            "source_span_end": 11,
            "holder": "self",
        }

        # Inv-14: the organisation mention is NEVER stamped — span keys only.
        org = self._row_for(em, "organisation")
        assert org["metadata"] == {"source_span_start": 20, "source_span_end": 37}
        assert "holder" not in org["metadata"]

    def test_supplier_cert_carries_supplier_name(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A holds rel from a non-client org stamps holder:supplier + supplier_name."""
        flow = _flow_module()
        monkeypatch.setenv("PIPELINE_CLIENT_ORG", "Knowledge Hub Ltd")
        markdown = "# Doc\n\nAcme Security holds ISO 27001."

        mentions = [
            self._mention("ISO 27001", "certification", start=2, end=11),
            self._mention("Acme Security", "organisation", start=20, end=33),
        ]
        rels = [self._rel("Acme Security", "holds", "ISO 27001")]
        self._stub_with_mentions_and_rels(flow, monkeypatch, markdown, mentions, rels)

        src = tmp_path / "doc.md"
        src.write_text(markdown)
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        asyncio.run(_exercise())

        from scripts.cocoindex_pipeline.canonicalisation import (
            canonicalise_for_relationship,
        )

        cert = self._row_for(em, "certification")
        assert cert["metadata"] == {
            "source_span_start": 2,
            "source_span_end": 11,
            "holder": "supplier",
            "supplier_name": canonicalise_for_relationship("Acme Security"),
        }

    def test_no_signal_cert_keeps_span_only_metadata(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A cert with NO holds/synonym rel keeps span-only metadata (Inv-10)."""
        flow = _flow_module()
        monkeypatch.setenv("PIPELINE_CLIENT_ORG", "Knowledge Hub Ltd")
        markdown = "# Doc\n\nISO 27001 mentioned with no holder rel."

        mentions = [self._mention("ISO 27001", "certification", start=2, end=11)]
        rels: list = []  # no relationships → no holder signal
        self._stub_with_mentions_and_rels(flow, monkeypatch, markdown, mentions, rels)

        src = tmp_path / "doc.md"
        src.write_text(markdown)
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        asyncio.run(_exercise())

        cert = self._row_for(em, "certification")
        assert cert["metadata"] == {"source_span_start": 2, "source_span_end": 11}
        assert "holder" not in cert["metadata"]

    def test_unset_client_org_degrades_to_span_only(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Unset PIPELINE_CLIENT_ORG → R4 raise is caught (Inv-15); span-only rows.

        The doc STILL ingests — the holder-derivation fault is logged-and-swallowed
        rather than aborting the em declares.
        """
        flow = _flow_module()
        monkeypatch.delenv("PIPELINE_CLIENT_ORG", raising=False)
        markdown = "# Doc\n\nKnowledge Hub Ltd holds ISO 27001."

        mentions = [self._mention("ISO 27001", "certification", start=2, end=11)]
        rels = [self._rel("Knowledge Hub Ltd", "holds", "ISO 27001")]
        self._stub_with_mentions_and_rels(flow, monkeypatch, markdown, mentions, rels)

        src = tmp_path / "doc.md"
        src.write_text(markdown)
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        warnings: list[str] = []
        monkeypatch.setattr(flow._logger, "warning", lambda msg: warnings.append(msg))

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        # Must NOT raise — the R4 fault is swallowed by the Inv-15 wrapper.
        asyncio.run(_exercise())

        # The cert row STILL landed, with span-only metadata (no holder key).
        cert = self._row_for(em, "certification")
        assert cert["metadata"] == {"source_span_start": 2, "source_span_end": 11}
        assert "holder" not in cert["metadata"]
        # The degradation was LOGGED, not silent.
        assert any("holder_derivation_failed" in w for w in warnings), (
            "the R4 fail-fast must be logged via the Inv-15 wrapper"
        )
