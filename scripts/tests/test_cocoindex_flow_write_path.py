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

Reference: docs/specs/cocoindex-flow-scaffolding/RESEARCH.md §R1/§R2/§R3/§R6.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest


_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402


# ── cocoindex stub install (mirrors sibling real-flow test files) ─────────────
# flow.py registers a process-global `coco.App(name="kh_pipeline")` + a
# `@coco.lifespan` + a `coco.ContextKey("kh_pipeline_db")` at import. The real
# cocoindex enforces uniqueness on all three, so importing flow with the REAL
# cocoindex would leak those registrations and break the idle-mode re-import
# contract (test_cocoindex_flow_idle_mode.py) in the combined suite. We import
# flow behind `stubbed_sys_modules` so flow captures STUB references for the
# registration surfaces (no global contamination) while `passthrough_coco_fn`
# keeps `@coco.fn` / `@coco.lifespan`-decorated functions real + awaitable. The
# 28.28 stub-isolation redesign tracks the broader cleak story; this file simply
# follows the documented `stubbed_sys_modules` pattern. (28.21/28.22 finding.)


class _StubContextKey:
    """Hashable ContextKey stand-in — usable as a dict key (lifespan provide)."""

    def __init__(self, key: str = "stub") -> None:
        self.key = key


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.fn = passthrough_coco_fn  # keep @coco.fn(memo=True) a real passthrough
    stub.lifespan = lambda fn=None: fn  # @coco.lifespan returns the fn unchanged
    stub.ContextKey = _StubContextKey
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.mount_each = MagicMock(name="mount_each")
    stub.use_context = MagicMock(name="use_context")
    stub.EnvironmentBuilder = MagicMock(name="EnvironmentBuilder")
    return stub


def _flow_module():
    """Import flow under stubbed cocoindex (no global registry contamination)."""
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
    sys.modules.pop("cocoindex_pipeline.flow", None)
    with stubbed_sys_modules(stubs):
        from cocoindex_pipeline import flow  # noqa: PLC0415

        return flow


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
        from cocoindex_pipeline.flow_context import bind_flow_meta

        # Stub the P-3 adapter + Path A extractors so no Docling / anthropic /
        # network is touched — we are proving the WRITE-PATH shape, not extraction.
        markdown = "# Heading\n\nHello world body text."

        async def _fake_convert(file: object) -> str:
            return markdown

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study", "primary_domain": "procurement"}

        async def _fake_qa(content_text: str):
            return {
                "qa_pairs": [
                    {"question_text": "What is X?", "answer_text": "X is Y."}
                ]
            }

        async def _fake_entities(content_text: str):
            return []

        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)

        # Stage one real file so file.read_text() works.
        src = tmp_path / "doc-one.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")

        run_op_id = uuid.uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                # 4-arg call — mount_each passes fn(File, *extra_args); the key
                # (relative path) is consumed by mount_each for subpath routing
                # and is NOT passed to fn (cocoindex 1.0.3 api.py _mount_one).
                await flow.ingest_file(fake_file, ci, qa, sd)

        asyncio.run(_exercise())

        # source_documents: exactly one row, op_id stamped, storage_path
        # DERIVED FROM THE FILE (file.file_path.path.as_posix()) — NOT a
        # phantom rel_path param that mount_each would never supply.
        assert len(sd.rows) == 1, "expected one source_documents row"
        assert sd.rows[0]["op_id"] == run_op_id
        assert sd.rows[0]["storage_path"] == src.as_posix(), (
            "storage_path must derive from file.file_path.path, not a param"
        )

        # content_items: exactly one row, content_text present, op_id stamped,
        # embedding NULL (28.24 deferred), content_text_hash OMITTED (GENERATED).
        assert len(ci.rows) == 1, "expected one content_items row"
        ci_row = ci.rows[0]
        assert ci_row["op_id"] == run_op_id
        assert ci_row["content_text"] == markdown
        assert ci_row.get("embedding") is None
        assert "content_text_hash" not in ci_row, (
            "content_text_hash is GENERATED ALWAYS — must be omitted from the row"
        )
        # content_items row references the source_documents row it came from.
        assert ci_row["source_document_id"] == sd.rows[0]["id"]

        # q_a_extractions: one row per qa_pair, op_id stamped, FK to content_items.
        assert len(qa.rows) == 1, "expected one q_a_extractions row per qa_pair"
        qa_row = qa.rows[0]
        assert qa_row["op_id"] == run_op_id
        assert qa_row["source_content_item_id"] == ci_row["id"]
        assert qa_row["extracted_question_text"] == "What is X?"

    def test_ingest_file_is_exposed_and_callable(self) -> None:
        """``ingest_file`` is a @coco.fn(memo=True) per-item component fn."""
        flow = _flow_module()

        assert hasattr(flow, "ingest_file"), "flow.py must expose ingest_file"
        # Decorated @coco.fn → AsyncFunction; stubbed cocoindex → plain async fn.
        # The robust check is callability (matches the idle-mode test pattern).
        assert callable(flow.ingest_file)


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
        from cocoindex_pipeline.flow_context import bind_flow_meta

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

        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)

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

        run_op_id = uuid.uuid4()

        # Keyed feed: (relative_path_str, File) — the key is what mount_each
        # routes on; the value (File) is what reaches ingest_file.
        feed = _FakeItemsFeed(
            [("doc-one.md", file_one), ("doc-two.md", file_two)]
        )

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await _faithful_mount_each(flow.ingest_file, feed, ci, qa, sd)

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

        # content_text differs per file (the per-item File reached the adapter).
        assert {r["content_text"] for r in ci.rows} == {
            markdown_one,
            markdown_two,
        }

        # Distinct stable PKs per document (idempotency substrate — uuid5 keyed
        # on the per-document identity, NOT uuid4 which would break Inv-4).
        assert len({r["id"] for r in sd.rows}) == 2
        assert len({r["id"] for r in ci.rows}) == 2

    def test_ingest_file_signature_matches_mount_each_extra_args(self) -> None:
        """``ingest_file`` accepts exactly (file, ci, qa, sd) positionally.

        Inspecting the signature directly pins the arity contract: the leading
        parameter is the File item value, followed by the three target extra
        args — and there is NO leading ``rel_path`` parameter (the blocker).
        """
        flow = _flow_module()

        params = list(inspect.signature(flow.ingest_file).parameters)
        assert params[0] != "rel_path", (
            "ingest_file must NOT lead with rel_path — mount_each passes "
            "fn(File, *extra_args); the key is never forwarded to fn"
        )
        # First param is the File item value; remaining three are the targets.
        assert len(params) == 4, (
            f"ingest_file must take exactly (file, ci, qa, sd); got {params}"
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
        from cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# Stable\n\nSame bytes every run."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

        async def _fake_entities(content_text: str):
            return []

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=run_op_id):
                await flow.ingest_file(fake_file, ci, qa, sd)  # type: ignore[attr-defined]

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
        from cocoindex_pipeline.flow_context import bind_flow_meta

        markdown = "# FP\n\nFingerprint body."

        async def _fake_convert(file: object) -> str:
            return markdown

        async def _fake_classification(content_text: str):
            return {"content_type": "case_study"}

        async def _fake_qa(content_text: str):
            return {"qa_pairs": []}

        async def _fake_entities(content_text: str):
            return []

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
        monkeypatch.setattr(flow, "extract_classification", _fake_classification)
        monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
        monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)

        src = tmp_path / "doc-fp.md"
        src.write_text(markdown)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, ci, qa, sd)

        asyncio.run(_exercise())

        fingerprint = sd.rows[0]["content_fingerprint"]
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
