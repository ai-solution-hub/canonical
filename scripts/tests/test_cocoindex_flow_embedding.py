"""Stage-4 embedding write-path proof (ID-49.2).

Proves the Stage-4 embedding wiring inside ``ingest_file`` WITHOUT the cocoindex
Rust engine, a real DB, or a live OpenAI call. The suite stubs cocoindex exactly
like ``test_cocoindex_flow_write_path.py`` (the sibling whose ``_FakeTarget`` /
``_FakeFile`` harness this mirrors), and injects a fake embedder via the
``flow.embed_content_text`` seam so no network is touched.

WHAT THIS PROVES (ID-49.2 — Stage-4 embedding):
  - ``ingest_file`` computes an embedding for ``content_text`` and passes a
    NON-None, length-1024 numeric vector into ``ci_target.declare_row``'s
    ``embedding`` field (replacing the ``embedding=None`` stub).
  - The embedding is sourced from ``flow.embed_content_text(content_text)`` — the
    production seam that wraps ``LiteLLMEmbedder("text-embedding-3-large",
    dimensions=1024).embed(...)``. Tests inject a fake here.
  - ``ingest_file`` does NOT call ``declare_vector_index`` on any target. The
    pgvector HNSW cosine index on ``content_items.embedding`` is migration-owned
    (``idx_content_items_embedding`` in the pre-squash migration), and the
    cocoindex ``declare_vector_index`` route would issue out-of-band ``CREATE
    INDEX`` DDL that bypasses ``managed_by=ManagedBy.USER`` — see the ID-49.2
    journal OQ. Stage-4 declares the embedding VALUE only, never index DDL.

WHAT THIS DOES NOT PROVE (ID-49.6 integration domain):
  - A real OpenAI ``text-embedding-3-large`` call returning a genuine 1024-dim
    vector, and a cosine query retrieving the row from a live Supabase target.

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via ``asyncio.run`` inside sync test functions.

Reference: docs/themes/canonical-pipeline/reference/canonical-pipeline-sequencing.md §2.5.
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


# ── cocoindex stub install (mirrors test_cocoindex_flow_write_path.py) ────────


class _StubContextKey:
    """Hashable ContextKey stand-in — usable as a dict key (lifespan provide)."""

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
    """Load flow under this file's stubbed cocoindex (per-file reload isolation).

    Pops any resident ``cocoindex_pipeline.flow`` first, then imports FRESH under
    the stubs. Mirrors test_cocoindex_build_dsn.py's resilient pop-then-import
    pattern rather than test_cocoindex_flow_write_path.py's reload — the reload
    form raises ``ImportError: module cocoindex_pipeline.flow not in sys.modules``
    when an earlier file (e.g. build_dsn) popped the module from the registry and
    a sibling re-imported it under the ``scripts.cocoindex_pipeline.flow``
    namespace key instead (ID-49.7 reload-isolation fragility). The pop forces a
    clean re-exec of flow.py's body under THIS file's stubs regardless of
    collection order.
    """
    import sys as _sys  # noqa: PLC0415

    coco_stub = _make_coco_stub()
    localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
    pg_stub = MagicMock(name="cocoindex.connectors.postgres")
    pg_stub.ColumnDef = MagicMock(name="ColumnDef")
    pg_stub.TableSchema = MagicMock(name="TableSchema")
    pg_stub.mount_table_target = MagicMock(name="mount_table_target")
    target_stub = MagicMock(name="cocoindex.connectorkits.target")
    target_stub.ManagedBy = MagicMock(name="ManagedBy")
    # NB: `cocoindex.ops.litellm` is NOT stubbed here. flow.py imports
    # `LiteLLMEmbedder` LAZILY (inside `_get_embedder`, only on first real
    # embedding), so the module body imports cleanly under a bare cocoindex stub.
    # Every test in this file injects a fake via the `flow.embed_content_text`
    # seam, so `_get_embedder` is never reached and no live embedder loads.
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
    # Pop both namespace keys so flow.py re-executes its module body under THIS
    # file's stubs (a stale entry under either key would shortcut the import and
    # leave a sibling-stub-captured module resident).
    _sys.modules.pop("cocoindex_pipeline.flow", None)
    _sys.modules.pop("scripts.cocoindex_pipeline.flow", None)

    with stubbed_sys_modules(stubs):
        from cocoindex_pipeline import flow  # noqa: PLC0415

    return flow


# ── Fakes (mirror test_cocoindex_flow_write_path.py) ──────────────────────────


class _FakeTarget:
    """Records declare_row / declare_vector_index calls without a DB."""

    def __init__(self, table_name: str) -> None:
        self.table_name = table_name
        self.rows: list[dict] = []
        self.vector_indexes: list[dict] = []

    def declare_row(self, *, row: dict) -> None:
        self.rows.append(row)

    def declare_vector_index(self, **kwargs: object) -> None:
        self.vector_indexes.append(dict(kwargs))


class _FakeFile:
    """Minimal localfs.File stand-in: async read/read_text + file_path."""

    class _FilePath:
        def __init__(self, path: Path) -> None:
            self.path = path

    def __init__(self, path: Path) -> None:
        self.file_path = _FakeFile._FilePath(path)
        self._path = path

    async def size(self) -> int:
        # cocoindex File.size (byte length) — mirrors the real FileLike. The
        # ID-64.11 source_documents write reads file.size for file_size (NOT NULL).
        return self._path.stat().st_size

    async def read(self) -> bytes:
        return self._path.read_bytes()

    async def read_text(self) -> str:
        return self._path.read_text()

    async def content_fingerprint(self) -> bytes:
        import hashlib

        return hashlib.sha256(self._path.read_bytes()).digest()


_MARKDOWN = "# Heading\n\nHello world body text for embedding."


def _patch_extractors(flow, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the P-3 adapter + Path A extractors (no Docling / anthropic / net)."""

    async def _fake_convert(file: object) -> str:
        return _MARKDOWN

    async def _fake_classification(content_text: str):
        return {"content_type": "case_study", "primary_domain": "procurement"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

    async def _fake_entities(content_text: str):
        return []

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)


def _exercise_ingest(flow, fake_file, ci, qa, sd, em, run_op_id) -> None:
    """Drive a single ``ingest_file`` invocation under a ``bind_flow_meta``.

    Per ID-53.10 §P-4 the ``em_target`` is the fourth extra arg expected by
    ``ingest_file`` (declare_row body for entity_mentions ships at {53.11}).
    """
    from cocoindex_pipeline.flow_context import bind_flow_meta  # noqa: PLC0415

    async def _run() -> None:
        async with bind_flow_meta(op_id=run_op_id):
            await flow.ingest_file(fake_file, ci, qa, sd, em, None, None)

    asyncio.run(_run())


# ── ID-49.2 — Stage-4 embedding write-path shape ──────────────────────────────


class TestIngestFileEmbedding:
    """ingest_file computes a 1024-vector and declares it on content_items."""

    def test_ingest_file_declares_1024_length_embedding(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _patch_extractors(flow, monkeypatch)

        captured: dict[str, object] = {}

        async def _fake_embed(content_text: str) -> list[float]:
            captured["content_text"] = content_text
            # Deterministic, non-uniform 1024-length numeric vector.
            return [round((i % 7) * 0.013 - 0.04, 6) for i in range(1024)]

        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-embed.md"
        src.write_text(_MARKDOWN)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")
        run_op_id = uuid.uuid4()

        _exercise_ingest(flow, fake_file, ci, qa, sd, em, run_op_id)

        assert len(ci.rows) == 1, "expected one content_items row"
        embedding = ci.rows[0]["embedding"]
        assert embedding is not None, "embedding must NOT be the None stub"
        assert len(embedding) == 1024, "embedding must be a length-1024 vector"
        assert all(isinstance(v, (int, float)) for v in embedding), (
            "embedding entries must be numeric"
        )
        # The embedder was fed the converted content_text (Stage 2 output).
        assert captured["content_text"] == _MARKDOWN

    def test_ingest_file_does_not_declare_vector_index(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The HNSW index is migration-owned; ingest_file must not declare it.

        Calling declare_vector_index would have cocoindex issue out-of-band
        CREATE INDEX DDL that bypasses managed_by=USER (ID-49.2 journal OQ).
        """
        flow = _flow_module()
        _patch_extractors(flow, monkeypatch)

        async def _fake_embed(content_text: str) -> list[float]:
            return [0.001 * (i + 1) for i in range(1024)]

        monkeypatch.setattr(flow, "embed_content_text", _fake_embed)

        src = tmp_path / "doc-noindex.md"
        src.write_text(_MARKDOWN)
        fake_file = _FakeFile(src)

        ci = _FakeTarget("content_items")
        qa = _FakeTarget("q_a_extractions")
        sd = _FakeTarget("source_documents")
        em = _FakeTarget("entity_mentions")

        _exercise_ingest(flow, fake_file, ci, qa, sd, em, uuid.uuid4())

        assert ci.vector_indexes == [], (
            "ingest_file must NOT declare a vector index — the HNSW cosine index "
            "is migration-owned (idx_content_items_embedding)"
        )
        assert qa.vector_indexes == []
        assert sd.vector_indexes == []

    def test_embed_content_text_seam_is_exposed(self) -> None:
        """flow exposes an awaitable embed_content_text(content_text) seam."""
        flow = _flow_module()
        assert hasattr(flow, "embed_content_text"), (
            "flow.py must expose embed_content_text for Stage-4 embedding"
        )
        assert inspect.iscoroutinefunction(flow.embed_content_text), (
            "embed_content_text must be an async coroutine function"
        )
        params = list(inspect.signature(flow.embed_content_text).parameters)
        assert params == ["content_text"], (
            f"embed_content_text must take exactly (content_text); got {params}"
        )
