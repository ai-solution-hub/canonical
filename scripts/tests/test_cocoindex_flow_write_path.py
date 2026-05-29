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
    """Load flow under this file's stubbed cocoindex (per-file reload isolation).

    Uses `importlib.reload()` under `stubbed_sys_modules()` so that each call
    re-executes `flow.py`'s module body with the write-path stubs active —
    giving this file a fresh `@coco.lifespan` passthrough and a fresh
    `_StubContextKey`-backed `DB_CTX` regardless of which sibling test file
    imported flow first (ID-49.7 per-file reload isolation).

    `importlib.reload()` updates the MODULE OBJECT IN-PLACE (unlike
    `sys.modules.pop + re-import`, which hits Python's package-attribute cache
    and silently returns the old module when a sibling file already imported it).

    To protect sibling files' `flow.aiohttp` stub pin (set as a module-level
    attribute by test_cocoindex_flow_pipeline_run_webhook.py), we snapshot the
    current `flow.aiohttp` value before reload and restore it afterwards. This
    preserves cooperative-stub discipline (ID-44.5) across collection order.
    """
    import importlib  # noqa: PLC0415

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
    # Ensure flow is imported at least once so the module object exists.
    with stubbed_sys_modules(stubs):
        from cocoindex_pipeline import flow  # noqa: PLC0415  (first import only)

    # Snapshot any flow.aiohttp pin set by a sibling test file at collection
    # time (test_cocoindex_flow_pipeline_run_webhook.py pins its _StubSession).
    # reload() resets this attribute; we must restore it to preserve the
    # cooperative-stub discipline across collection orderings (ID-44.5).
    _prior_aiohttp = getattr(flow, "aiohttp", None)

    # reload() re-executes flow.py with our stubs in sys.modules — the
    # @coco.lifespan passthrough + _StubContextKey DB_CTX land correctly.
    with stubbed_sys_modules(stubs):
        importlib.reload(flow)

    # Restore the sibling's aiohttp pin if one was set before the reload.
    if _prior_aiohttp is not None and isinstance(_prior_aiohttp, MagicMock):
        flow.aiohttp = _prior_aiohttp

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

    @property
    def size(self) -> int:
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

        # content_items: exactly one row, content_text present, op_id stamped,
        # embedding a length-1024 vector (Stage-4 ID-49.2; the dimension contract
        # is proved in test_cocoindex_flow_embedding.py), content_text_hash
        # OMITTED (GENERATED ALWAYS).
        assert len(ci.rows) == 1, "expected one content_items row"
        ci_row = ci.rows[0]
        assert ci_row["op_id"] == run_op_id
        assert ci_row["content_text"] == markdown
        assert len(ci_row["embedding"]) == 1024
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
        """``ingest_file`` accepts exactly (file, ci, qa, sd, em, ft, ftf).

        Inspecting the signature directly pins the arity contract: the leading
        parameter is the File item value, followed by the six target extra args
        — and there is NO leading ``rel_path`` parameter (the original blocker).

        ID-52.12 extended the arity from five to seven: ``ft_target`` /
        ``ftf_target`` (the ``form_templates`` / ``form_template_fields``
        Path-B write targets) follow ``em_target`` positionally, matching the
        ``coco.mount_each`` extra-arg order in ``app_main``.
        """
        flow = _flow_module()

        params = list(inspect.signature(flow.ingest_file).parameters)
        assert params[0] != "rel_path", (
            "ingest_file must NOT lead with rel_path — mount_each passes "
            "fn(File, *extra_args); the key is never forwarded to fn"
        )
        # First param is the File item value; remaining six are the targets.
        assert len(params) == 7, (
            f"ingest_file must take exactly (file, ci, qa, sd, em, ft, ftf); "
            f"got {params}"
        )
        assert params[-2:] == ["ft_target", "ftf_target"], (
            "the last two extra args must be ft_target then ftf_target "
            f"(TECH §2.5 positional order); got {params}"
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


# ── 42.9 — pullmd provenance lands on the source_documents write ──────────────


class TestSourceDocumentProvenanceWritePath:
    """The recorded source_documents row carries extraction_method + pullmd_share_id.

    Proves the WIRING SHAPE (ID-42.9 §WP-E): ``ingest_file`` resolves provenance
    via ``extract_source_provenance`` (the real helper, routing by suffix) and
    writes ``extraction_method`` / ``pullmd_share_id`` into the declare_row dict.
    Stubs ONLY at the ``_pullmd_to_markdown``/httpx boundary per
    docs/reference/test-philosophy.md — the live-service proof is {42.10}'s job.
    The content_text path (Stage 3-6) stays stubbed so this is a pure shape test.
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
        from cocoindex_pipeline.flow_context import bind_flow_meta

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)  # type: ignore[attr-defined]

        asyncio.run(_exercise())
        return sd

    def test_html_source_carries_pullmd_method_and_share_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        from unittest.mock import AsyncMock
        import sys as _sys

        self._stub_extractors(flow, monkeypatch)

        # Stub the content_text path (the str body feeding Stages 3-6) so no
        # network is touched on the markdown side; the provenance side is proved
        # via the real extract_source_provenance routing + a stubbed pullmd HTTP.
        async def _fake_convert(file: object) -> str:
            return "# HTML body\n\nExtracted markdown."

        monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)

        # Stub the pullmd HTTP boundary only (test-philosophy: shape, not service).
        # Resolve the EXACT adapters module flow imported extract_source_provenance
        # from (flow.py uses `scripts.cocoindex_pipeline.adapters`; sibling tests
        # may import `cocoindex_pipeline.adapters` — different module objects). We
        # patch `_pullmd_to_markdown` on the function's OWN globals so the patch is
        # module-identity-agnostic.
        adapters = _sys.modules[flow.extract_source_provenance.__module__]
        stub_result = adapters.PullmdResult(
            markdown="# HTML body\n\nExtracted markdown.",
            x_source="playwright",
            x_quality=0.77,
            share_id="cafe1234",
        )
        monkeypatch.setattr(
            adapters, "_pullmd_to_markdown", AsyncMock(return_value=stub_result)
        )

        src = tmp_path / "page.html"
        src.write_text("<html><body>hi</body></html>")
        sd = self._ingest(flow, _FakeFile(src))

        assert len(sd.rows) == 1
        assert sd.rows[0]["extraction_method"] == "pullmd_playwright"
        assert sd.rows[0]["pullmd_share_id"] == "cafe1234"

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

    @property
    def size(self) -> int:
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


def _make_manifest(flow: object, prefix: str, workspace_id: "uuid.UUID"):
    """Build a real WorkspaceManifest mapping ``prefix`` → ``workspace_id``."""
    from cocoindex_pipeline.workspace_resolver import (
        WorkspaceManifest,
        WorkspaceMapping,
    )

    return WorkspaceManifest(
        schema_version=1,
        mappings=[WorkspaceMapping(path_prefix=prefix, workspace_id=workspace_id)],
    )


def _make_extracted_form(flow: object, fields: list[dict]):
    """Build an ExtractedForm with the given fields (dict kwargs per field)."""
    from cocoindex_pipeline.form_extractors.shared import (
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
    from cocoindex_pipeline.flow_context import (
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
        manifest = _make_manifest(flow, "acme/", ws)

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
        manifest = _make_manifest(flow, "acme/", ws)
        src = tmp_path / "no-title.pdf"
        src.write_bytes(b"%PDF stub")
        fake_file = _FakeFormFile("acme/no-title.pdf", src)

        from cocoindex_pipeline.form_extractors.shared import (
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
        manifest = _make_manifest(flow, "acme/", ws)
        src = tmp_path / "zero-archetype.xlsx"
        src.write_bytes(b"PK\x03\x04 stub xlsx bytes")
        rel_path = "acme/zero-archetype.xlsx"
        fake_file = _FakeFormFile(rel_path, src)

        from cocoindex_pipeline.form_extractors.shared import (
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
        manifest = _make_manifest(flow, "acme/", ws)
        src = tmp_path / "zero-with-method.xlsx"
        src.write_bytes(b"PK\x03\x04 stub")
        fake_file = _FakeFormFile("acme/zero-with-method.xlsx", src)

        from cocoindex_pipeline.form_extractors.shared import (
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
        manifest = _make_manifest(flow, "acme/", ws)
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
        manifest = _make_manifest(flow, "acme/", ws)
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

    def test_resolution_failure_no_form_rows_and_stage_error(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Inv-5: ResolutionFailure → 0 form_templates + 0 fields + a
        workspace_resolution stage error (no sentinel row)."""
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

        out = _ingest_form(flow, fake_file, manifest=manifest, monkeypatch=monkeypatch)

        assert out["ft"].rows == []
        assert out["ftf"].rows == []
        assert extract_called["value"] is False, (
            "resolution must fail BEFORE extraction (Inv-5 — no extraction work "
            "on an unmapped path)"
        )
        ws_errors = [e for e in emitted if e.get("stage") == "workspace_resolution"]
        assert ws_errors, "a workspace_resolution stage error must be emitted"
        assert ws_errors[0]["error_class"] == "extraction_validation_failed"


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
        manifest = _make_manifest(flow, "acme/", ws)
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
        manifest = _make_manifest(flow, "acme/", ws)
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

        from cocoindex_pipeline.flow_context import (
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
