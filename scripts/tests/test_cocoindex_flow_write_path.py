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
        # cocoindex File.size — the byte length. Used by the ID-52 form-write
        # block for `form_templates.file_size` (NOT NULL). Derived from the
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
                # the content_items write maps it to the NOT-NULL `title` column.
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        # Stage one real file so file.read_text() works.
        src = tmp_path / "doc-one.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                # 5-arg call — mount_each passes fn(File, *extra_args); the key
                # (relative path) is consumed by mount_each for subpath routing
                # and is NOT passed to fn (cocoindex 1.0.3 api.py _mount_one).
                # em_target (4th extra arg) lands per ID-53.10 §P-4; declare_row
                # body for entity_mentions ships at {53.11}.
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # source_documents: exactly one row, op_id stamped, storage_path
        # DERIVED FROM THE FILE (file.file_path.path.as_posix()) — NOT a
        # phantom rel_path param that mount_each would never supply.
        assert len(sd.rows) == 1, "expected one source_documents row"
        assert sd.rows[0]["op_id"] == run_op_id
        assert sd.rows[0]["storage_path"] == src.as_posix(), (
            "storage_path must derive from file.file_path.path, not a param"
        )
        # ID-64.11 (S296): the NOT-NULL source_documents metadata is written —
        # filename (basename), mime_type (suffix-resolved), file_size (bytes) —
        # and content_hash is the prod column (renamed from content_fingerprint,
        # which does not exist in prod).
        assert sd.rows[0]["filename"] == "doc-one.md"
        assert sd.rows[0]["mime_type"] == "text/markdown"
        assert sd.rows[0]["file_size"] == src.stat().st_size
        assert isinstance(sd.rows[0]["content_hash"], str) and sd.rows[0]["content_hash"]
        assert "content_fingerprint" not in sd.rows[0], (
            "content_fingerprint does not exist in prod — must be content_hash"
        )
        # ID-75 BI-4: the localfs branch writes an EXPLICIT source_url None —
        # only URL-sourced documents populate it (the provenance split is
        # visible at the write site).
        assert sd.rows[0]["source_url"] is None, (
            "localfs files have no source URL — explicit None (ID-75 BI-4)"
        )

        # content_items: exactly one row, content present, op_id stamped,
        # embedding a length-1024 vector (Stage-4 ID-49.2; the dimension contract
        # is proved in test_cocoindex_flow_embedding.py), content_text_hash
        # OMITTED (GENERATED ALWAYS).
        assert len(ci.rows) == 1, "expected one content_items row"
        ci_row = ci.rows[0]
        assert ci_row["op_id"] == run_op_id
        # ID-64.10 (S296): prod body column is `content` (rename from the
        # non-existent content_text).
        assert ci_row["content"] == markdown
        assert "content_text" not in ci_row, (
            "content_text does not exist in prod — must be `content`"
        )
        # ID-64.10 (S296): title + content_type are NOT NULL in prod and are now
        # written — title from the classifier's suggested_title (fallback =
        # filename stem); content_type from the taxonomy-validated classifier value.
        assert ci_row["title"] == "Doc One Title"
        assert ci_row["content_type"] == "case_study"
        assert len(ci_row["embedding"]) == 1024
        assert "content_text_hash" not in ci_row, (
            "content_text_hash is GENERATED ALWAYS — must be omitted from the row"
        )
        # content_items row references the source_documents row it came from.
        assert ci_row["source_document_id"] == sd.rows[0]["id"]
        # ID-63.7 (OQ-63-9): the classification's domain AND subtopic are
        # persisted to content_items on the cocoindex re-ingest path (today
        # neither was written). Both keys ride the declare_row payload.
        assert ci_row["primary_domain"] == "procurement", (
            "primary_domain must be persisted to content_items (OQ-63-9)"
        )
        assert ci_row["primary_subtopic"] == "tender_evaluation", (
            "primary_subtopic must be persisted to content_items (OQ-63-9)"
        )

        # q_a_extractions: one row per qa_pair, op_id stamped, FK to content_items.
        assert len(qa.rows) == 2, "expected one q_a_extractions row per qa_pair"
        qa_row = qa.rows[0]
        assert qa_row["op_id"] == run_op_id
        assert qa_row["source_content_item_id"] == ci_row["id"]
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-one.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        # The production per-flow counter (NOT a stub) so we exercise the real
        # `_FlowStageCounter.increment(stage)` substrate `app_main` folds.
        counter = flow._FlowStageCounter()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_stage_counter(counter):
                    await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # source_walk / binary_conversion: one per item.
        assert counter.get("source_walk") == 1
        assert counter.get("binary_conversion") == 1
        # llm_extraction: the classification + qa_form + entity_mentions trio.
        assert counter.get("llm_extraction") == 3
        # embedding: unchanged contract (one vector per content row).
        assert counter.get("embedding") == 1
        # postgres_upsert: one per declare_row — sd + ci + one qa_pair row
        # (zero entity rows, Path B inactive: no manifest bound).
        assert counter.get("postgres_upsert") == 3

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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc.md"
        src.write_text(markdown)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            # NO bind_stage_counter — `_bump` must be a no-op.
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), ci, qa, sd, em, None, None)

        asyncio.run(_exercise())  # must not raise

        assert len(sd.rows) == 1 and len(ci.rows) == 1


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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        # Stage two real files (so file.read_text() works in the adapter path).
        src_one = tmp_path / "doc-one.md"
        src_one.write_text(markdown_one)
        src_two = tmp_path / "doc-two.md"
        src_two.write_text(markdown_two)
        file_one = _FakeFile(src_one)
        file_two = _FakeFile(src_two)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        run_op_id = uuid.uuid4()

        # Keyed feed: (relative_path_str, File) — the key is what mount_each
        # routes on; the value (File) is what reaches ingest_file.
        feed = _FakeItemsFeed(
            [("doc-one.md", file_one), ("doc-two.md", file_two)]
        )

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await _faithful_mount_each(flow.ingest_file, feed, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # Both files flowed through the 4-arg contract: one sd + one ci + one
        # qa row PER source file (2 of each).
        assert len(sd.rows) == 2, "expected one source_documents row per file"
        assert len(ci.rows) == 2, "expected one content_items row per file"
        assert len(qa.rows) == 2, "expected one q_a_extractions row per file"

        # Each row carries the run op_id (plain field from current_flow_meta()).
        assert {r["op_id"] for r in sd.rows} == {run_op_id}
        assert {r["op_id"] for r in ci.rows} == {run_op_id}

        # storage_path derives from EACH File's own path (proves the per-item
        # File reached the body, not a single phantom param).
        assert {r["storage_path"] for r in sd.rows} == {
            src_one.as_posix(),
            src_two.as_posix(),
        }

        # content differs per file (the per-item File reached the adapter).
        assert {r["content"] for r in ci.rows} == {
            markdown_one,
            markdown_two,
        }

        # Distinct stable PKs per document (idempotency substrate — uuid5 keyed
        # on the per-document identity, NOT uuid4 which would break Inv-4).
        assert len({r["id"] for r in sd.rows}) == 2
        assert len({r["id"] for r in ci.rows}) == 2

    def test_ingest_file_signature_matches_mount_each_extra_args(self) -> None:
        """``ingest_file`` accepts (file, ci, qa, sd, em, ft, ftf, cc=None).

        Inspecting the signature directly pins the arity contract: the leading
        parameter is the File item value, followed by the seven target extra
        args — and there is NO leading ``rel_path`` parameter (the original
        blocker).

        ID-52.12 extended the arity from five to seven: ``ft_target`` /
        ``ftf_target`` (the ``form_templates`` / ``form_template_fields``
        Path-B write targets) follow ``em_target`` positionally, matching the
        ``coco.mount_each`` extra-arg order in ``app_main``.

        ID-56.8 extended it to eight: ``cc_target`` (the ``content_chunks``
        chunk-row UPSERT target) is appended as a DEFAULTED 8th positional
        (``cc_target=None``) so the existing 7-arg callers stay valid while
        ``app_main`` always supplies it via ``mount_each``.

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
        # First positional is the File item value; remaining seven are the targets.
        assert len(positional) == 8, (
            f"ingest_file positional params must be exactly "
            f"(file, ci, qa, sd, em, ft, ftf, cc); got {positional}"
        )
        assert positional[-3:] == ["ft_target", "ftf_target", "cc_target"], (
            "the last three positional extra args must be ft_target, ftf_target, "
            f"cc_target (positional order); got {positional}"
        )
        # cc_target is DEFAULTED to None so 7-arg legacy callers stay valid.
        assert sig.parameters["cc_target"].default is None, (
            "cc_target must default to None (the 7-arg callers omit it)"
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)  # type: ignore[attr-defined]

        asyncio.run(_exercise())
        return {"ci": ci.rows, "qa": qa.rows, "sd": sd.rows}

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
        assert rows_a["ci"][0]["id"] == rows_b["ci"][0]["id"], (
            "content_items PK must be stable across runs (Inv-4 idempotency)"
        )
        assert rows_a["qa"][0]["id"] == rows_b["qa"][0]["id"], (
            "q_a_extractions PK must be stable across runs (Inv-4 idempotency)"
        )

        # The op_id ROW FIELD differs — it identifies the RUN, not the PK
        # (ratified OQ-A: full_reprocess re-stamps the same row's op_id).
        assert rows_a["sd"][0]["op_id"] == run_a
        assert rows_b["sd"][0]["op_id"] == run_b
        assert rows_a["sd"][0]["op_id"] != rows_b["sd"][0]["op_id"]


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
    _CI_ID = uuid.UUID("390cb80c-ae52-5769-b3db-1c34df81a7a1")  # ci:{rel}
    _QA0_ID = uuid.UUID("1552220b-1f2b-5901-adc9-b84b94a5a099")  # qa:{rel}:0
    _QA1_ID = uuid.UUID("05be7ffd-305c-55f9-9068-805d1fa1fae9")  # qa:{rel}:1

    _GOLDEN_QA_ROWS = [
        {
            "id": _QA0_ID,
            "source_content_item_id": _CI_ID,
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
            "source_content_item_id": _CI_ID,
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "inv19-doc.md"
        src.write_text(markdown)
        fake_file = _FakeFormFile(cls._REL_PATH, src)

        targets = {
            "ci": _FakeTarget("content_items"),
            "qa": _FakeTarget("q_a_extractions"),
            "sd": _FakeTarget("source_documents"),
            "em": _FakeTarget("entity_mentions"),
            "ft": _FakeTarget("form_templates"),
            "ftf": _FakeTarget("form_template_fields"),
        }

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=cls._OP_ID):
                if manifest is None:
                    await flow.ingest_file(
                        fake_file,
                        targets["ci"],
                        targets["qa"],
                        targets["sd"],
                        targets["em"],
                        targets["ft"],
                        targets["ftf"],
                    )
                else:
                    async with bind_workspace_manifest(manifest):
                        await flow.ingest_file(
                            fake_file,
                            targets["ci"],
                            targets["qa"],
                            targets["sd"],
                            targets["em"],
                            targets["ft"],
                            targets["ftf"],
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
        # And the fork's mutual exclusion held: zero form rows either way.
        assert out["ft"].rows == []
        assert out["ftf"].rows == []


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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-fp.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        fingerprint = sd.rows[0]["content_hash"]
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


# ── 42.9 — pullmd provenance lands on the source_documents write ──────────────


class TestSourceDocumentProvenanceWritePath:
    """The recorded source_documents row carries extraction_method + pullmd_share_id.

    Proves the WIRING SHAPE (ID-42.9 §WP-E): ``ingest_file`` resolves provenance
    via ``extract_source_provenance`` (the real helper, routing by suffix) and
    writes ``extraction_method`` / ``pullmd_share_id`` into the declare_row dict.
    Stubs ONLY at the ``_pullmd_http_get``/httpx boundary per
    docs/reference/test-philosophy.md — the live-service proof is {42.10}'s job.
    The content_text path (Stage 3-6) stays stubbed so this is a pure shape test.

    ID-75 WP-D: the localfs HTML→PullMD branch is RETIRED — a staged
    .html/.htm now fails LOUDLY per-file (LocalfsHtmlRetiredError) with NO
    PullMD call; HTML content lands via the URL source instead.
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

    @staticmethod
    def _ingest(flow: object, fake_file: object) -> "_FakeTarget":
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)  # type: ignore[attr-defined]

        asyncio.run(_exercise())
        return sd

    def test_html_source_raises_loud_retired_error_with_no_pullmd_call(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A staged .html fails LOUDLY (LocalfsHtmlRetiredError) — NO PullMD call.

        ID-75 WP-D: HTML content lands via the URL source; the file corpus does
        not route HTML to PullMD (a local file path is unreachable for the
        service anyway). The error propagates out of ``ingest_file`` and is
        contained per-file at the mount boundary (ID-80.9) — one bad .html
        never aborts the batch. ZERO rows land on any target.
        """
        flow = _flow_module()
        from unittest.mock import AsyncMock
        import sys as _sys

        self._stub_extractors(flow, monkeypatch)

        # convert_binary_to_markdown is NOT stubbed: the REAL adapter routing
        # must raise the named error at Stage 2 — that is the behaviour under
        # test. Stub only the pullmd HTTP boundary to prove it is never reached.
        # Resolve the EXACT adapters module flow imported the helpers from
        # (module-identity-agnostic, as the sibling tests do).
        adapters = _sys.modules[flow.extract_source_provenance.__module__]
        pullmd_http = AsyncMock(name="_pullmd_http_get")
        monkeypatch.setattr(adapters, "_pullmd_http_get", pullmd_http)

        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        src = tmp_path / "page.html"
        src.write_text("<html><body>hi</body></html>")
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)  # type: ignore[attr-defined]

        with pytest.raises(adapters.LocalfsHtmlRetiredError):
            asyncio.run(_exercise())

        # The retired branch must never reach the PullMD HTTP boundary…
        assert pullmd_http.await_count == 0, (
            "PullMD was called for a localfs HTML file — the retired branch leaked"
        )
        # …and the failed file declares ZERO rows on every target.
        assert ci.rows == []
        assert qa.rows == []
        assert sd.rows == []
        assert em.rows == []

    def test_docling_source_carries_docling_method_and_null_share_id(
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
        sd = self._ingest(flow, _FakeFile(src))

        assert len(sd.rows) == 1
        assert sd.rows[0]["extraction_method"] == "docling"
        assert sd.rows[0]["pullmd_share_id"] is None

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
        sd = self._ingest(flow, _FakeFile(src))

        assert len(sd.rows) == 1
        assert sd.rows[0]["extraction_method"] is None
        assert sd.rows[0]["pullmd_share_id"] is None


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


# ── 52.12 — Path B pipeline-owned form-template write block ───────────────────


_FORM_TYPE = "tender"  # a value present in the canonical taxonomy snapshot


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


def _stub_path_a(flow: object, monkeypatch: "pytest.MonkeyPatch") -> None:
    """Stub the Path-A adapter + extractors + embedder so the form-write block
    is exercised in isolation (no Docling / anthropic / OpenAI / network)."""

    async def _fake_convert(file: object) -> str:
        return "# Form\n\nbody"

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
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _make_manifest(
    flow: object, prefix: str, workspace_id: "uuid.UUID", *, route: str = "content"
):
    """Build a real WorkspaceManifest mapping ``prefix`` → ``workspace_id``.

    ID-80.8: the per-prefix ``route`` tag is the fork discriminator — form-write
    tests pass ``route="forms"`` so the file takes the form branch (the default
    ``"content"`` keeps every other prefix on Path-A, 80.2 §B.2)."""
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


def _make_extracted_form(flow: object, fields: list[dict]):
    """Build an ExtractedForm with the given fields (dict kwargs per field)."""
    from scripts.cocoindex_pipeline.form_extractors.shared import (
        ExtractedField,
        ExtractedForm,
        FormMetadata,
    )

    return ExtractedForm(
        form_metadata=FormMetadata(
            form_type=_FORM_TYPE,
            form_format="pdf",
            form_title="Acme Tender 2026",
            issuing_organisation="Acme Council",
            evaluation_methodology="MEAT 60/40",
        ),
        fields=[ExtractedField(**f) for f in fields],
    )


def _spy_trim(flow: object, monkeypatch: "pytest.MonkeyPatch") -> list[tuple]:
    """Patch the trim seam so the DELETE contract is observable without a pool.

    Records each ``(template_id, new_max_sequence)`` call so tests can assert
    the trim ran (and ran BEFORE field declares — checked via call ordering)."""
    calls: list[tuple] = []

    async def _fake_trim(template_id, new_max_sequence) -> None:
        calls.append((template_id, new_max_sequence))

    monkeypatch.setattr(flow, "_trim_stale_form_fields", _fake_trim)
    return calls


def _ingest_form(
    flow: object,
    fake_file: object,
    *,
    manifest: object,
    monkeypatch: "pytest.MonkeyPatch",
) -> dict:
    """Drive one ingest_file under bind_flow_meta + bind_workspace_manifest."""
    from scripts.cocoindex_pipeline.flow_context import (
        bind_flow_meta,
        bind_workspace_manifest,
    )

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")
    ft = _FakeTarget("form_templates")
    ftf = _FakeTarget("form_template_fields")

    run_op_id = uuid.uuid4()

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            async with bind_workspace_manifest(manifest):
                await flow.ingest_file(fake_file, ci, qa, sd, em, ft, ftf)

    asyncio.run(_exercise())
    return {"ci": ci, "qa": qa, "sd": sd, "em": em, "ft": ft, "ftf": ftf,
            "op_id": run_op_id}


class TestFormWriteSuccessPath:
    """A resolvable, extractable form → one analysed form_templates row + N
    form_template_fields rows with stable deterministic UUID5s (Inv-6/7/8)."""

    def test_success_declares_form_template_and_fields(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)

        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")

        # Stage the form on disk; the logical rel_path is under the mapped
        # prefix so resolution succeeds.
        src = tmp_path / "blank-form.pdf"
        src.write_bytes(b"%PDF-1.7 stub bytes")
        rel_path = "acme/blank-form.pdf"
        fake_file = _FakeFormFile(rel_path, src)

        async def _fake_extract(file: object):
            return _make_extracted_form(
                flow,
                [
                    {"question_text": "Describe your approach", "field_type": "empty_cell",
                     "fill_status": "pending", "sequence": 0, "word_limit": 500,
                     "is_mandatory": True, "section_name": "A"},
                    {"placeholder_text": "[Insert]", "field_type": "placeholder",
                     "fill_status": "pending", "sequence": 1, "row_index": 2,
                     "col_index": 1, "table_index": 0,
                     "reference_urls": ["https://example.org/guide"]},
                ],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        # Exactly one form_templates row, status analysed.
        assert len(out["ft"].rows) == 1
        ft_row = out["ft"].rows[0]
        assert ft_row["status"] == "analysed"
        assert ft_row["workspace_id"] == ws
        assert ft_row["created_by"] == flow.SERVICE_ACCOUNT_UUID
        assert ft_row["mime_type"] == "application/pdf"
        assert ft_row["file_size"] == src.stat().st_size
        assert ft_row["field_count"] == 2
        assert ft_row["mapped_count"] == 0
        assert ft_row["ingest_source"] == "pipeline"
        assert ft_row["name"] == "Acme Tender 2026"  # form_title preferred
        assert ft_row["description"] == "MEAT 60/40"
        assert ft_row["form_type"] == _FORM_TYPE
        assert ft_row["issuing_organisation"] == "Acme Council"
        assert ft_row["storage_path"] == rel_path
        assert ft_row["structure_path"] is None
        # The form_templates PK is the deterministic ft: UUID5.
        assert ft_row["id"] == uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"ft:{rel_path}"
        )

        # Two field rows with deterministic ftf: UUID5s + correct payloads.
        assert len(out["ftf"].rows) == 2
        for field_row in out["ftf"].rows:
            assert field_row["template_id"] == ft_row["id"]
            expected_id = uuid.uuid5(
                flow._KH_PIPELINE_DOC_NS, f"ftf:{rel_path}:{field_row['sequence']}"
            )
            assert field_row["id"] == expected_id
            assert "question_id" not in field_row  # Path-C owned
            assert "mapping_status" not in field_row  # DB default owned
        # Field-specific payload checks.
        f0 = out["ftf"].rows[0]
        assert f0["question_text"] == "Describe your approach"
        assert f0["word_limit"] == 500
        assert f0["is_mandatory"] is True
        f1 = out["ftf"].rows[1]
        assert f1["placeholder_text"] == "[Insert]"
        assert f1["reference_urls"] == ["https://example.org/guide"]

    def test_name_falls_back_to_stem_when_no_title(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "no-title.pdf"
        src.write_bytes(b"%PDF stub")
        fake_file = _FakeFormFile("acme/no-title.pdf", src)

        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedForm,
            FormMetadata,
        )

        async def _fake_extract(file: object):
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type=_FORM_TYPE, form_format="pdf", form_title=None
                ),
                fields=[],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)
        assert out["ft"].rows[0]["name"] == "no-title"  # file stem


class TestFormWriteMemoHitRoundTrip:
    """ID-80.13 (D2) — the form branch must declare the SAME row set when the
    extraction arrives as a memo-HIT dict (REAL cocoindex serde round-trip)
    as when it arrives as the live typed ``ExtractedForm``.

    S316 live-smoke evidence: walk-2's memo HIT handed ``ingest_file`` a plain
    dict (cocoindex deserialises with hint=Any because the orchestrator's
    ``"FileLike"`` annotation is unresolvable at runtime) → ``.form_metadata``
    AttributeError → ft/ftf rows never declared → cocoindex declared-target
    reconciliation garbage-collected walk-1's rows (ft=0/ftf=0).

    NB: the dict is produced by the REAL ``cocoindex._internal.serde``
    serialise→deserialise pair — NOT by mocking the memo into returning the
    live typed object, which is exactly why {80.10}'s idempotency sweep
    missed this defect."""

    @staticmethod
    def _form_with_deadline(flow: object):
        """A typed ExtractedForm whose ``deadline`` exercises the JSON-unstable
        datetime crossing the memo boundary (the bl-220-class shape)."""
        from datetime import datetime, timezone

        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedField,
            ExtractedForm,
            FormMetadata,
        )

        return ExtractedForm(
            form_metadata=FormMetadata(
                form_type=_FORM_TYPE,
                form_format="docx",
                form_title="ITT Services",
                issuing_organisation="Acme Council",
                deadline=datetime(2026, 7, 1, 12, 0, 0, tzinfo=timezone.utc),
                evaluation_methodology="MEAT 60/40",
            ),
            fields=[
                ExtractedField(
                    question_text="Describe your approach",
                    field_type="empty_cell",
                    fill_status="pending",
                    sequence=0,
                    word_limit=500,
                    is_mandatory=True,
                ),
                ExtractedField(
                    placeholder_text="[Insert]",
                    field_type="placeholder",
                    fill_status="pending",
                    sequence=1,
                ),
            ],
        )

    def _run_walk(
        self,
        flow: object,
        monkeypatch: "pytest.MonkeyPatch",
        tmp_path: Path,
        extraction_value: object,
    ) -> dict:
        """One form-branch pass with ``extract_form_structure`` returning
        ``extraction_value`` (typed on walk-1; the serde dict on walk-2)."""
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.UUID("11111111-1111-4111-8111-111111111111")
        manifest = _make_manifest(flow, "s316-smoke/", ws, route="forms")
        src = tmp_path / "ITT Services.docx"
        src.write_bytes(b"PK\x03\x04 stub docx bytes")
        fake_file = _FakeFormFile("s316-smoke/forms/ITT Services.docx", src)

        async def _fake_extract(file: object):
            return extraction_value

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        return _ingest_form(
            flow, fake_file, manifest=manifest, monkeypatch=monkeypatch
        )

    def test_memo_hit_dict_declares_identical_row_set_to_typed_walk(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Walk-1 (typed) and walk-2 (REAL-serde memo-HIT dict) must declare
        identical ft + ftf row sets — same id-stable uuid5 ``ft:``/``ftf:``
        keys, same payloads — so re-walk idempotency holds and reconciliation
        never garbage-collects the form rows."""
        from typing import Any

        from cocoindex._internal import serde

        flow = _flow_module()
        form = self._form_with_deadline(flow)

        # Walk-1: live typed extraction (the memo MISS path).
        walk1 = self._run_walk(flow, monkeypatch, tmp_path, form)
        assert len(walk1["ft"].rows) == 1
        assert len(walk1["ftf"].rows) == 2

        # Walk-2: the REAL memo-HIT payload — serialise with the real
        # cocoindex serde, deserialise under the hint=Any fallback (dict).
        memo_hit = serde.deserialize(serde.serialize(form), Any)
        assert isinstance(memo_hit, dict), "precondition: memo HIT is a dict"

        # Must NOT raise (pre-fix: AttributeError at extracted.form_metadata).
        walk2 = self._run_walk(flow, monkeypatch, tmp_path, memo_hit)

        # Identical declared row sets — the Inv-16 idempotency contract.
        assert walk2["ft"].rows == walk1["ft"].rows, (
            "walk-2 (memo HIT) must declare the SAME form_templates row as "
            "walk-1 — any drift lets reconciliation garbage-collect the form"
        )
        assert walk2["ftf"].rows == walk1["ftf"].rows, (
            "walk-2 (memo HIT) must declare the SAME form_template_fields "
            "rows as walk-1 (id-stable ftf: uuid5 keys)"
        )
        # And the rows carry the deterministic uuid5 keys (id-stability).
        rel_path = "s316-smoke/forms/ITT Services.docx"
        assert walk2["ft"].rows[0]["id"] == uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"ft:{rel_path}"
        )
        assert {r["id"] for r in walk2["ftf"].rows} == {
            uuid.uuid5(flow._KH_PIPELINE_DOC_NS, f"ftf:{rel_path}:{seq}")
            for seq in (0, 1)
        }
        # The deadline survived the round-trip as a datetime (bl-220-class
        # JSON-unstable field) and landed on the declared row both walks.
        assert walk2["ft"].rows[0]["deadline"] == form.form_metadata.deadline


class TestFormWriteGracefulEmptyProvenance:
    """PRODUCT Inv-17 graceful-empty-with-recorded-reason (ratified S278).

    A structurally readable form that yields ZERO fields (e.g. a valid XLSX
    whose sheets matched no archetype) is GRACEFUL: it STAYS
    ``status='analysed'`` (distinct from the ``analysis_failed`` strict-raise
    path) but MUST carry a recorded reason on the row provenance so it is never
    left as an ``analysed``/0-field row with no recorded reason — the exact
    shape Inv-17 forbids."""

    def test_zero_field_form_records_reason_on_row_and_stays_analysed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "zero-archetype.xlsx"
        src.write_bytes(b"PK\x03\x04 stub xlsx bytes")
        rel_path = "acme/zero-archetype.xlsx"
        fake_file = _FakeFormFile(rel_path, src)

        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedForm,
            FormMetadata,
        )

        async def _fake_extract(file: object):
            # A structurally readable XLSX that matched no archetype: the reader
            # returned an empty ExtractedForm gracefully (NO FormExtractionError)
            # — the xlsx.py NO_ARCHETYPE_REASON path.
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type=_FORM_TYPE,
                    form_format="xlsx",
                    form_title="Internal Project Notes",
                    # No authored evaluation_methodology — the recorded reason
                    # must become the row description rather than leaving it None.
                ),
                fields=[],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        # GRACEFUL: exactly one row, status STAYS analysed (NOT analysis_failed).
        assert len(out["ft"].rows) == 1
        ft_row = out["ft"].rows[0]
        assert ft_row["status"] == "analysed"
        assert ft_row["field_count"] == 0
        # RECORDED REASON: the description carries the Inv-17 graceful-empty
        # reason token so the row is never silently empty.
        assert ft_row["description"] is not None
        assert flow.FORM_WRITE_GRACEFUL_EMPTY_REASON in ft_row["description"]
        # No field rows for a zero-field form.
        assert out["ftf"].rows == []
        # Same deterministic ft: UUID5 so a later re-ingest with fields UPSERTs
        # this same row.
        assert ft_row["id"] == uuid.uuid5(flow._KH_PIPELINE_DOC_NS, f"ft:{rel_path}")

    def test_authored_description_is_preserved_over_graceful_reason(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """When the form carries an authored ``evaluation_methodology`` the
        graceful-empty reason does NOT clobber it — the description keeps the
        authored value (the surfaced reason still lands in the structured log)."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "zero-with-method.xlsx"
        src.write_bytes(b"PK\x03\x04 stub")
        fake_file = _FakeFormFile("acme/zero-with-method.xlsx", src)

        from scripts.cocoindex_pipeline.form_extractors.shared import (
            ExtractedForm,
            FormMetadata,
        )

        async def _fake_extract(file: object):
            return ExtractedForm(
                form_metadata=FormMetadata(
                    form_type=_FORM_TYPE,
                    form_format="xlsx",
                    form_title="Methodful",
                    evaluation_methodology="MEAT 70/30",
                ),
                fields=[],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)
        ft_row = out["ft"].rows[0]
        assert ft_row["status"] == "analysed"
        assert ft_row["field_count"] == 0
        assert ft_row["description"] == "MEAT 70/30"
        # Non-clobber contract: the graceful-empty reason must NOT be co-located
        # with an authored description (or-guard, never concatenation). {52.21} Checker nit.
        assert flow.FORM_WRITE_GRACEFUL_EMPTY_REASON not in ft_row["description"]

    def test_graceful_empty_reason_token_is_exposed(self) -> None:
        """``FORM_WRITE_GRACEFUL_EMPTY_REASON`` is the single source of truth for
        the recorded-reason token threaded onto the row provenance."""
        flow = _flow_module()
        assert isinstance(flow.FORM_WRITE_GRACEFUL_EMPTY_REASON, str)
        assert flow.FORM_WRITE_GRACEFUL_EMPTY_REASON


class TestFormWriteSkipAndFailurePaths:
    def test_xls_returns_none_no_form_rows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-3: .xls → extract_form_structure returns None → 0 form rows."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "legacy.xls"
        src.write_bytes(b"\xd0\xcf\x11\xe0")
        fake_file = _FakeFormFile("acme/legacy.xls", src)

        async def _fake_extract(file: object):
            # Mirror the orchestrator's .xls behaviour: returns None.
            return None

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)
        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)
        assert out["ft"].rows == []
        assert out["ftf"].rows == []

    def test_extraction_failure_records_analysis_failed_row_no_fields(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-17: FormExtractionError → 1 analysis_failed row + 0 fields; the
        batch is not halted (the call returns, it does not raise)."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "corrupt.pdf"
        src.write_bytes(b"not a pdf")
        rel_path = "acme/corrupt.pdf"
        fake_file = _FakeFormFile(rel_path, src)

        # Raise the SAME FormExtractionError class flow.py caught at import —
        # `flow.FormExtractionError` — not a re-imported sibling-namespace copy
        # (the `scripts.` vs bare `cocoindex_pipeline` dual-import-path hazard
        # would otherwise make flow's `except FormExtractionError` miss it).
        _FormExtractionError = flow.FormExtractionError

        async def _fake_extract(file: object):
            raise _FormExtractionError("corrupt_pdf", rel_path, "broken")

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow,
            "_emit_stage_error_log",
            lambda **kw: emitted.append(kw),
        )

        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        assert len(out["ft"].rows) == 1
        ft_row = out["ft"].rows[0]
        assert ft_row["status"] == "analysis_failed"
        assert ft_row["field_count"] == 0
        assert ft_row["created_by"] == flow.SERVICE_ACCOUNT_UUID
        assert ft_row["mime_type"] == "application/pdf"
        assert ft_row["workspace_id"] == ws
        # Same ft: UUID5 so a later successful re-ingest UPSERTs this row.
        assert ft_row["id"] == uuid.uuid5(flow._KH_PIPELINE_DOC_NS, f"ft:{rel_path}")
        assert out["ftf"].rows == []
        # A form_extraction stage error was emitted.
        assert any(e.get("stage") == "form_extraction" for e in emitted)

    def test_unmapped_path_no_form_rows_soft_warn_not_stage_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bl-219: an UNMAPPED path → 0 form rows + a benign WARNING soft-warn
        (`workspace_resolution.unmapped`), NOT a `cocoindex.stage_error`.

        An unmapped content path is observability-only: post-{80.8} fork an
        unmapped file soft-warns at the fork, defaults to `route=content` and
        runs the content branch, and the invocation does NOT fail, so emitting
        a stage error (Inv-26's failed-invocation companion) would be a false
        alarm. Asserts:
          (a) NO stage error with stage=='workspace_resolution' is emitted,
          (b) the soft-warn (`workspace_resolution.unmapped`, WARNING) IS emitted,
          (c) zero form_templates + zero form_template_fields rows,
          (d) extraction NOT called (resolution fails before extraction),
          (e) the content branch ran (unmapped → soft-warn → route=content →
              _ingest_content_branch) and the ci row landed (workspace-agnostic,
              ID-69 BI-1)."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # Manifest maps a DIFFERENT prefix → the staged file is unmapped.
        manifest = _make_manifest(flow, "other-client/", ws)
        src = tmp_path / "unmapped-form.pdf"
        src.write_bytes(b"%PDF stub")
        fake_file = _FakeFormFile("unmapped/unmapped-form.pdf", src)

        extract_called = {"value": False}

        async def _fake_extract(file: object):
            extract_called["value"] = True
            return _make_extracted_form(flow, [])

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )
        warns: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_workspace_unmapped_warn", lambda **kw: warns.append(kw)
        )

        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        # (c) Zero form rows — no sentinel row on an unmapped path.
        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        # (d) Resolution fails BEFORE extraction — no extraction work performed.
        assert extract_called["value"] is False, (
            "resolution must fail BEFORE extraction (no extraction work on an "
            "unmapped path)"
        )
        # (a) NO workspace_resolution stage error is emitted for an unmapped path.
        ws_errors = [e for e in emitted if e.get("stage") == "workspace_resolution"]
        assert ws_errors == [], (
            "an UNMAPPED path must NOT emit a workspace_resolution stage error "
            "(bl-219: it is observability-only, not a failed invocation)"
        )
        # (b) The benign WARNING soft-warn IS emitted exactly once.
        assert len(warns) == 1, "exactly one unmapped soft-warn must be emitted"
        assert warns[0]["content_items_id"] is not None
        # (e) Content still wrote (workspace-agnostic canonical layer, ID-69 BI-1).
        assert len(out["ci"].rows) == 1, (
            "content_items must still write on an unmapped path — workspace "
            "resolution is form-write-only and the content layer is "
            "workspace-agnostic (ID-69 BI-1)"
        )

    def test_unmapped_soft_warn_event_name_and_warning_level(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bl-219: the unmapped soft-warn emits a `workspace_resolution.unmapped`
        WARNING-level structured log (not an ERROR `cocoindex.stage_error`).

        Captures `_logger.warning` directly (rather than monkeypatching the
        helper) to lock the event name + level contract end-to-end."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        manifest = _make_manifest(flow, "other-client/", ws)
        src = tmp_path / "unmapped-form.pdf"
        src.write_bytes(b"%PDF stub")
        fake_file = _FakeFormFile("unmapped/unmapped-form.pdf", src)

        async def _fake_extract(file: object):
            return _make_extracted_form(flow, [])

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        warn_lines: list[str] = []
        monkeypatch.setattr(
            flow._logger, "warning", lambda msg, *a, **k: warn_lines.append(msg)
        )
        # If a stage error were (wrongly) emitted, capture it to fail loudly.
        error_lines: list[str] = []
        monkeypatch.setattr(
            flow._logger, "error", lambda msg, *a, **k: error_lines.append(msg)
        )

        _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        unmapped_warns = [
            json.loads(line)
            for line in warn_lines
            if isinstance(line, str) and '"workspace_resolution.unmapped"' in line
        ]
        assert len(unmapped_warns) == 1
        assert unmapped_warns[0]["event"] == "workspace_resolution.unmapped"
        assert "reason" in unmapped_warns[0]
        # No `cocoindex.stage_error` for stage workspace_resolution at ERROR.
        stage_errors = [
            json.loads(line)
            for line in error_lines
            if isinstance(line, str) and '"cocoindex.stage_error"' in line
        ]
        assert [
            e for e in stage_errors if e.get("stage") == "workspace_resolution"
        ] == []

    def test_ambiguous_resolution_no_form_rows_and_stage_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bl-219 regression guard: an AMBIGUOUS resolution (two equal-length
        matching prefixes tie) STAYS a loud `cocoindex.stage_error` —
        stage=='workspace_resolution', error_class=='extraction_validation_failed'
        — and produces zero form rows. Unlike the unmapped case, an ambiguous
        manifest is a genuine mis-wire that must not be downgraded."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()

        from scripts.cocoindex_pipeline.workspace_resolver import (
            WorkspaceManifest,
            WorkspaceMapping,
        )

        # Two equal-length prefixes that BOTH match the rel_path → ambiguous.
        # `model_construct` bypasses the duplicate-prefix load validator to
        # exercise the resolver's defensive tie-detection branch.
        other_ws = uuid.uuid4()
        manifest = WorkspaceManifest.model_construct(
            schema_version=1,
            mappings=[
                WorkspaceMapping.model_construct(path_prefix="acme/", workspace_id=ws),
                WorkspaceMapping.model_construct(
                    path_prefix="acme/", workspace_id=other_ws
                ),
            ],
        )
        src = tmp_path / "ambiguous-form.pdf"
        src.write_bytes(b"%PDF stub")
        fake_file = _FakeFormFile("acme/ambiguous-form.pdf", src)

        extract_called = {"value": False}

        async def _fake_extract(file: object):
            extract_called["value"] = True
            return _make_extracted_form(flow, [])

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        emitted: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_stage_error_log", lambda **kw: emitted.append(kw)
        )
        warns: list[dict] = []
        monkeypatch.setattr(
            flow, "_emit_workspace_unmapped_warn", lambda **kw: warns.append(kw)
        )

        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        assert extract_called["value"] is False
        # Ambiguous stays LOUD: a workspace_resolution stage error IS emitted.
        ws_errors = [e for e in emitted if e.get("stage") == "workspace_resolution"]
        assert ws_errors, (
            "ambiguous resolution must STILL emit a workspace_resolution stage "
            "error (bl-219: only the unmapped case is downgraded)"
        )
        assert ws_errors[0]["error_class"] == "extraction_validation_failed"
        # And it must NOT be routed to the benign soft-warn.
        assert warns == [], "ambiguous resolution must not be soft-warned"


class TestFormWriteIdempotency:
    def test_two_runs_same_rel_path_identical_uuids(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-16 happy: two ingests of the same rel_path mint identical ft:/ftf:
        UUID5s, so declare_row UPSERTs the same rows."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)
        _spy_trim(flow, monkeypatch)
        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "stable-form.pdf"
        src.write_bytes(b"%PDF stable")
        fake_file = _FakeFormFile("acme/stable-form.pdf", src)

        async def _fake_extract(file: object):
            return _make_extracted_form(
                flow,
                [{"question_text": "Q", "field_type": "empty_cell",
                  "fill_status": "pending", "sequence": 0}],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        out_a = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)
        out_b = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        assert out_a["ft"].rows[0]["id"] == out_b["ft"].rows[0]["id"]
        assert out_a["ftf"].rows[0]["id"] == out_b["ftf"].rows[0]["id"]

    def test_stale_trim_runs_before_field_declares(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-16 shrink: the stale-row trim is invoked with (template_id,
        max_sequence) BEFORE any form_template_fields row is declared."""
        flow = _flow_module()
        _stub_path_a(flow, monkeypatch)

        ws = uuid.uuid4()
        # ID-80.8: route="forms" so the fork takes the form branch (the
        # pre-fork dispatcher ran the form block for every manifest-active
        # file; the ratified fork requires the explicit route tag).
        manifest = _make_manifest(flow, "acme/", ws, route="forms")
        src = tmp_path / "shrink-form.pdf"
        src.write_bytes(b"%PDF shrink")
        rel_path = "acme/shrink-form.pdf"
        fake_file = _FakeFormFile(rel_path, src)

        async def _fake_extract(file: object):
            return _make_extracted_form(
                flow,
                [
                    {"question_text": "Q0", "field_type": "empty_cell",
                     "fill_status": "pending", "sequence": 0},
                    {"question_text": "Q1", "field_type": "empty_cell",
                     "fill_status": "pending", "sequence": 1},
                ],
            )

        monkeypatch.setattr(flow, "extract_form_structure", _fake_extract)

        # Order-recording trim spy: append a marker so we can assert it ran
        # before the first field declare.
        order: list[str] = []

        async def _fake_trim(template_id, new_max_sequence) -> None:
            order.append(f"trim:{new_max_sequence}")

        monkeypatch.setattr(flow, "_trim_stale_form_fields", _fake_trim)

        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            bind_workspace_manifest,
        )

        class _OrderingTarget(_FakeTarget):
            def declare_row(self, *, row: dict) -> None:
                order.append("field_declare")
                super().declare_row(row=row)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _OrderingTarget("form_template_fields")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_workspace_manifest(manifest):
                    await flow.ingest_file(fake_file, ci, qa, sd, em, ft, ftf)

        asyncio.run(_exercise())

        # The trim recorded the new max sequence (1) and ran before any field.
        assert "trim:1" in order
        assert order.index("trim:1") < order.index("field_declare"), (
            "stale-row trim must run BEFORE the form_template_fields declares "
            "(TECH §2.8)"
        )
        # Two field rows landed.
        assert len(ftf.rows) == 2

    def test_trim_resolves_pool_via_use_context_and_issues_shrink_delete(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The REAL ``_trim_stale_form_fields`` body resolves the env-scope pool
        through ``coco.use_context(DB_CTX)`` (NOT ``ContextKey.get()``, which has
        no such method — bl-224) and issues the Inv-16 shrink DELETE against
        ``public.form_template_fields`` keyed on ``(template_id, sequence)``.

        Every flow-level form test patches the ``_trim_stale_form_fields`` seam
        (``_spy_trim`` / ``_fake_trim``), so the real body — and the broken
        ``DB_CTX.get()`` accessor — never executed in any test. This exercises
        the unpatched body directly: it would raise ``AttributeError`` against a
        ``ContextKey`` before the fix.
        """
        flow = _flow_module()

        executed: list[tuple] = []

        class _FakeConn:
            async def execute(self, sql: str, *params: object) -> None:
                executed.append((sql, params))

        class _FakeAcquire:
            async def __aenter__(self) -> "_FakeConn":
                return _FakeConn()

            async def __aexit__(self, *exc: object) -> bool:
                return False

        class _FakePool:
            def acquire(self) -> "_FakeAcquire":
                return _FakeAcquire()

        fake_pool = _FakePool()
        use_context_calls: list[object] = []

        def _fake_use_context(key: object) -> "_FakePool":
            use_context_calls.append(key)
            return fake_pool

        # Monkeypatch the single-arg read accessor on the imported cocoindex
        # module the flow uses (`import cocoindex as coco`). The real engine is
        # not running, so there is no environment to resolve DB_CTX from.
        monkeypatch.setattr(flow.coco, "use_context", _fake_use_context)

        template_id = uuid.uuid4()
        new_max_sequence = 3

        asyncio.run(
            flow._trim_stale_form_fields(template_id, new_max_sequence)
        )

        # (a) the pool was resolved via coco.use_context(DB_CTX) — not .get().
        assert use_context_calls == [flow.DB_CTX], (
            "the env-scope pool must be resolved via coco.use_context(DB_CTX); "
            "ContextKey has no .get() (bl-224)"
        )

        # (b) the shrink DELETE ran with the (template_id, new_max_sequence)
        # params against form_template_fields.
        assert len(executed) == 1, "exactly one DELETE statement is issued"
        sql, params = executed[0]
        assert sql == (
            "DELETE FROM public.form_template_fields "
            "WHERE template_id = $1 AND sequence > $2"
        )
        assert params == (template_id, new_max_sequence)


# ── ID-69 — canonical cross-workspace association ingest invariants ───────────
#
# v1 ships NO ingest-side junction writer (the resolver is single-valued on this
# branch; the multi-workspace carrier is deferred to v1.1). These tests pin the
# ingest-side PRECONDITIONS that make the operator-side association contract
# (`__tests__/api/items/workspaces-contract.test.ts`) safe to reuse unchanged:
#
#   BI-1 — the canonical `content_items` row has NO intrinsic workspace; a record
#          with zero junction rows is still complete.
#   BI-2 — workspace association is NEVER written to `source_documents` (its
#          declared row carries no `workspace_id`); association rides
#          `content_item_workspaces` only.
#   BI-6 — a changed-bytes re-ingest re-stamps the SAME `content_item_id` via the
#          deterministic `uuid5` identity, declaring the parent row as an UPSERT
#          (stable PK) — NOT a delete-and-reinsert, which would FK-cascade every
#          junction row away.
#   BI-8 — association is explicit (operator/manifest), never inferred from
#          folder layout or LLM classification.
#
# Reference (verified S291, NOT modified by these tests): flow.py identity
# `content_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")` (:1335);
# `content_items` declare (:1361, no workspace key); `source_documents` declare
# (:1342, no workspace key); FK `content_item_workspaces.content_item_id ->
# content_items.id ON DELETE CASCADE` (migration :5361); composite PK :4318.


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
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _run_ingest(
    flow: object, fake_file: object
) -> tuple["_FakeTarget", "_FakeTarget"]:
    """Drive one real ``ingest_file`` (no manifest bound → Path A only) and
    return the (content_items, source_documents) fake targets.
    """
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

    ci = _FakeTarget("content_items")
    qa = _FakeTarget("q_a_extractions")
    sd = _FakeTarget("source_documents")
    em = _FakeTarget("entity_mentions")

    async def _exercise() -> None:
        async with bind_flow_meta(op_id=uuid.uuid4()):
            await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)  # type: ignore[attr-defined]

    asyncio.run(_exercise())
    return ci, sd


class TestReingestUpsertPreservesAssociations:
    """{69.6} — BI-6: a changed-bytes re-ingest re-stamps the SAME identity and
    leaves any existing junction associations intact.

    The load-bearing precondition is that ``content_items`` is declared as a
    deterministic-PK UPSERT (the parent ``id`` is stable across re-ingest), NOT
    a DELETE+INSERT. Because the junction FKs ``content_items.id ON DELETE
    CASCADE``, a stable parent ``id`` means existing ``content_item_workspaces``
    rows are never orphaned or cascaded away. This test asserts that discipline;
    it would fail loudly if the identity drifted on re-ingest (the symptom of an
    accidental delete-and-reinsert). No runtime change to flow.py — the guard is
    a test (TECH Q3).
    """

    def test_changed_bytes_reingest_restamps_same_content_item_id(
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
        ci_first, _ = _run_ingest(flow, _FakeFile(src))

        assert len(ci_first.rows) == 1, "expected one content_items row on ingest"
        content_item_id = ci_first.rows[0]["id"]

        # Simulate the operator (or a future ingest-side writer) associating the
        # canonical record with a workspace — the junction keyed on the parent id.
        workspace_id = uuid.uuid4()
        junction: set[tuple[uuid.UUID, uuid.UUID]] = {
            (content_item_id, workspace_id)
        }

        # Re-ingest the SAME file with CHANGED bytes (a content edit).
        src.write_text("# Policy v2\n\nRevised body text — substantially changed.")
        _stub_canonical_extractors(
            flow,
            monkeypatch,
            markdown="# Policy v2\n\nRevised body text — substantially changed.",
        )
        ci_second, _ = _run_ingest(flow, _FakeFile(src))

        # (a) Identity is unchanged — uuid5 is a pure function of rel_path.
        assert len(ci_second.rows) == 1
        reingested_id = ci_second.rows[0]["id"]
        assert reingested_id == content_item_id, (
            "re-ingest must re-stamp the SAME content_item_id (deterministic "
            "uuid5 on rel_path) — a drifted id is the symptom of a "
            "delete-and-reinsert that would cascade the junction away (BI-6)"
        )

        # (b) The declared row is an UPSERT of the same PK, NOT a new identity:
        #     the changed content rides the SAME id (declare_row re-stamps the
        #     existing row; op_id is a plain field, not part of the PK).
        assert ci_second.rows[0]["content"] != ci_first.rows[0]["content"], (
            "the re-ingest carries the changed bytes (content actually changed)"
        )
        assert ci_second.rows[0]["id"] == ci_first.rows[0]["id"], (
            "the changed content is UPSERTed onto the SAME content_items PK "
            "(not a delete+insert under a new id)"
        )

        # (c) Because the parent id is stable, the FK-cascade never fires: the
        #     junction association is count-invariant across re-ingest.
        assert (content_item_id, workspace_id) in junction
        assert len(junction) == 1, (
            "the content_item_workspaces association must be invariant across "
            "a changed-bytes re-ingest (no FK cascade — BI-6)"
        )

    def test_distinct_files_get_distinct_identities(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Sanity counter-check: two DIFFERENT rel_paths yield DIFFERENT
        content_item_ids, so an association is never silently shared across
        documents (the identity is per-document, keyed on rel_path)."""
        flow = _flow_module()

        a = tmp_path / "corpus" / "doc-a.md"
        b = tmp_path / "corpus" / "doc-b.md"
        a.parent.mkdir(parents=True, exist_ok=True)
        a.write_text("# A\n\nbody a")
        b.write_text("# B\n\nbody b")

        _stub_canonical_extractors(flow, monkeypatch, markdown="# A\n\nbody a")
        ci_a, _ = _run_ingest(flow, _FakeFile(a))
        _stub_canonical_extractors(flow, monkeypatch, markdown="# B\n\nbody b")
        ci_b, _ = _run_ingest(flow, _FakeFile(b))

        assert ci_a.rows[0]["id"] != ci_b.rows[0]["id"], (
            "distinct documents must get distinct content_item_ids"
        )


class TestCanonicalRecordHasNoIntrinsicWorkspace:
    """{69.7} — BI-1/BI-2/BI-8: the canonical ingest declares content with no
    intrinsic workspace and never writes a workspace onto source_documents.
    Negative invariants — these assert the ABSENCE of any workspace coupling on
    the canonical (Path A) write path; association rides content_item_workspaces
    only, written explicitly by the operator route (or the deferred v1.1 writer).
    """

    def test_content_items_row_has_no_workspace_column_and_is_complete(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")

        ci, sd = _run_ingest(flow, _FakeFile(src))

        # BI-1: no workspace key on the declared content_items row…
        ci_row = ci.rows[0]
        assert "workspace_id" not in ci_row, (
            "content_items must carry NO intrinsic workspace (BI-1) — "
            "association is M2M via content_item_workspaces only"
        )
        assert "workspace_ids" not in ci_row, (
            "content_items must carry no embedded workspace list either (BI-1)"
        )
        # …and the record is COMPLETE with zero junction rows: the canonical
        # fields a downstream consumer needs are all present un-associated.
        assert ci_row["content"] == "# Doc\n\nbody"
        assert len(ci_row["embedding"]) == 1024
        assert ci_row["source_document_id"] == sd.rows[0]["id"]

    def test_source_documents_row_never_carries_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")

        _, sd = _run_ingest(flow, _FakeFile(src))

        # BI-2: the source_documents provenance row carries no workspace — the
        # canonical-path equivalent of `source_documents.workspace_id IS NULL`.
        sd_row = sd.rows[0]
        assert "workspace_id" not in sd_row, (
            "source_documents must NEVER carry a workspace (BI-2) — workspace "
            "association is written ONLY to content_item_workspaces"
        )

    def test_classification_output_is_never_a_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """BI-8: the LLM classification (primary_domain / primary_subtopic) is
        persisted to content_items but is NEVER interpreted as a workspace.
        Association is explicit, never inferred from classification."""
        flow = _flow_module()
        src = tmp_path / "doc.md"
        src.write_text("# Doc\n\nbody")
        _stub_canonical_extractors(flow, monkeypatch, markdown="# Doc\n\nbody")

        ci, _ = _run_ingest(flow, _FakeFile(src))
        ci_row = ci.rows[0]

        # The classifier output landed on its own columns…
        assert ci_row["primary_domain"] == "procurement"
        assert ci_row["primary_subtopic"] == "tender_evaluation"
        # …and did NOT leak into any workspace field (no classification->workspace
        # mapping exists on the canonical path — BI-8).
        assert "workspace_id" not in ci_row
        assert ci_row.get("primary_domain") != ci_row.get("workspace_id")


# ── 66.16 — stamp_extraction_base is WIRED into the per-item path (Inv-5) ──────


class TestStampExtractionBaseWiredIntoIngest:
    """PRODUCT Inv-5 [RATIFIED-S241]: every extraction variant carries op_id,
    content_items_id, and extracted_at — populated by the outer-tier cocoindex
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
                content_type="case_study",
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

    def test_each_extraction_object_is_stamped_with_flow_op_id_and_content_item_id(
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

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

        asyncio.run(_exercise())

        # The row's deterministic content_item_id (flow.py seeds it on rel_path).
        rel_path = src.as_posix()
        expected_content_item_id = uuid.uuid5(
            flow._KH_PIPELINE_DOC_NS, f"ci:{rel_path}"
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
            assert kwargs.get("content_items_id") == expected_content_item_id, (
                "stamp must be called with the explicit row content_item_id kwarg"
            )
            # bl-220 / ID-74: the INPUT is the stamp-FREE core the memo extractor
            # returns — it carries NO stamp fields (they must not cross the memo
            # boundary). The stamp is therefore a genuine CONSTRUCT-from-core, not
            # a sentinel overwrite.
            assert not hasattr(input_obj, "op_id")
            assert not hasattr(input_obj, "content_items_id")
            assert not hasattr(input_obj, "extracted_at")
            # The RESULT (the *Stamped* type) carries the flow op_id + the row's
            # content_item_id and a real (post-sentinel) extracted_at — Inv-5 is
            # satisfied on the object the row writers read.
            assert stamped.op_id == run_op_id
            assert stamped.content_items_id == expected_content_item_id
            assert stamped.extracted_at > _UNSTAMPED_AT

        # BEHAVIOUR-PRESERVING: the stamped object op_id EQUALS the flow op_id
        # already written to every row (the row writes are unchanged).
        assert sd.rows[0]["op_id"] == run_op_id
        assert ci.rows[0]["op_id"] == run_op_id
        assert ci.rows[0]["id"] == expected_content_item_id
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
        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        calls = self._spy_stamp(flow, monkeypatch)

        src = tmp_path / "doc-dict.md"
        src.write_text(markdown)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), ci, qa, sd, em, None, None)

        asyncio.run(_exercise())  # must not raise (no model_dump on a dict)

        assert calls == [], (
            "stamp_extraction_base must NOT be called for plain-dict extractor "
            "outputs — only genuine extraction-core instances are stamped"
        )
        # Rows still landed normally.
        assert len(sd.rows) == 1 and len(ci.rows) == 1 and len(qa.rows) == 1


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

        # Plain .md is non-form → extract_form_structure returns None; the
        # Path-B block resolves the workspace then exits cleanly (flow.py:1776).
        async def _form_none(file: object):
            return None

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _conv)
        monkeypatch.setattr(flow, "extract_classification", _cls)
        monkeypatch.setattr(flow, "extract_qa_form", _qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _ent)
        monkeypatch.setattr(flow, "embed_content_text", _emb)
        monkeypatch.setattr(flow, "extract_form_structure", _form_none)

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

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _FakeTarget("form_template_fields")

        async def _exercise() -> None:
            await flow.ingest_file(
                fake_file,
                ci,
                qa,
                sd,
                em,
                ft,
                ftf,
                None,
                flow_op_id=uuid.uuid4(),
                flow_workspace_manifest=manifest,
                flow_source_path=source_root,
            )

        asyncio.run(_exercise())

        # BUG-A: storage_path is the SOURCE-RELATIVE POSIX string, NOT the
        # absolute prod path. (Also the seed of the deterministic uuid5 PKs.)
        assert sd.rows[0]["storage_path"] == "test/doc.md", (
            "storage_path must be source-relative (the manifest prefix matches "
            "the relative form, not the absolute prod path)"
        )
        # Content lands independently of workspace resolution (ID-69 BI-1).
        assert len(ci.rows) == 1 and len(sd.rows) == 1
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

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        ft = _FakeTarget("form_templates")
        ftf = _FakeTarget("form_template_fields")

        async def _exercise() -> None:
            await flow.ingest_file(
                fake_file,
                ci,
                qa,
                sd,
                em,
                ft,
                ftf,
                None,
                flow_op_id=uuid.uuid4(),
            )

        # Must NOT raise (the pre-fix path raises ValueError on the .json suffix).
        asyncio.run(_exercise())

        # The manifest is not content → no rows declared on any target.
        assert sd.rows == [] and ci.rows == [] and qa.rows == [] and em.rows == []
        assert ft.rows == [] and ftf.rows == []

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

        Prod enforces UNIQUE (canonical_name, entity_type, content_item_id). The
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
        monkeypatch.setattr(flow, "embed_content_text", _emb)

        src = tmp_path / "doc.md"
        src.write_text(markdown)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            await flow.ingest_file(
                _FakeFile(src), ci, qa, sd, em, None, None, flow_op_id=uuid.uuid4()
            )

        asyncio.run(_exercise())

        # BUG-F: the two duplicate mentions collapse to exactly ONE row.
        assert len(em.rows) == 1, (
            f"expected 1 deduped entity_mentions row, got {len(em.rows)}"
        )
        assert em.rows[0]["entity_type"] == "company"
        # The higher-confidence mention is the one kept.
        assert em.rows[0]["confidence"] == 0.9
