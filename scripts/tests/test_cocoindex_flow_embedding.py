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


# bl-223 (cwd-robustness): pin THIS checkout's repo root to the FRONT of
# sys.path. The ID-67.2 removal of the path insert assumed pyproject.toml
# `pythonpath = ["scripts"]` made it redundant — true ONLY when pytest runs with
# cwd == this worktree. In a multi-worktree env (pytest invoked from another
# checkout root, or `cd /tmp && pytest <abs path>`), `scripts` is a namespace
# package resolved off sys.path, so without this insert flow.py's module-body
# `from scripts.cocoindex_pipeline.* import …` (lines 65-141) either fail to
# resolve (`No module named 'scripts'`) or bind a DIFFERENT checkout's modules.
# parents[2] of `scripts/tests/<file>.py` == this checkout's repo root; FRONT
# insertion makes the co-located checkout win over any sibling already on path.
_REPO_ROOT = str(Path(__file__).resolve().parents[2])
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []



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


# bl-223 (cwd-robustness): flow.py lives two dirs up from this test file —
# `scripts/tests/…` → parents[1] == `scripts/` → `cocoindex_pipeline/flow.py`.
# Loading BY PATH (not `from scripts.cocoindex_pipeline import flow`) makes the
# module-under-test load the CO-LOCATED checkout's flow.py regardless of cwd or
# sys.path ordering. The name-based import resolved `scripts` via sys.path, so in
# a multi-worktree env (pytest invoked from a different checkout root, or `cd /tmp
# && pytest <abs path>`) it bound the WRONG repo's flow.py — missing the bl-223
# `_truncate_embedding_input`/`_get_embedding_encoder` symbols → AttributeError,
# leaving the truncation assertions unverified (the Checker regression).
_FLOW_PATH = Path(__file__).resolve().parents[1] / "cocoindex_pipeline" / "flow.py"


def _flow_module():
    """Load flow BY PATH under this file's stubbed cocoindex (cwd-robust).

    Loads `flow.py` from its on-disk location next to this test file via
    ``importlib.util.spec_from_file_location`` so the load is independent of cwd
    / sys.path ordering (bl-223 — the name-based ``from scripts.cocoindex_pipeline
    import flow`` resolved a DIFFERENT checkout's flow.py when pytest ran from
    another root). Pops both legacy + canonical ``sys.modules`` keys first so
    flow.py re-executes its body FRESH under THIS file's stubs regardless of
    collection order (the prior pop-then-import discipline is preserved), then
    registers the freshly-built module under the canonical
    ``scripts.cocoindex_pipeline.flow`` key BEFORE ``exec_module`` so its
    function-local ``from scripts.cocoindex_pipeline import …`` references and any
    sibling ``importlib.reload(flow)`` resolve to this same identity.
    """
    import importlib.util as _imp_util  # noqa: PLC0415
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
    # The truncation tests inject a fake via `flow._get_embedder`, and the
    # ingest-shape tests via the `flow.embed_content_text` seam, so no live
    # embedder ever loads.
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
    _canonical = "scripts.cocoindex_pipeline.flow"
    # Pop both namespace keys so flow.py re-executes its module body under THIS
    # file's stubs (a stale entry under either key would shortcut the import and
    # leave a sibling-stub-captured module resident).
    _sys.modules.pop("cocoindex_pipeline.flow", None)
    _sys.modules.pop(_canonical, None)

    with stubbed_sys_modules(stubs):
        spec = _imp_util.spec_from_file_location(_canonical, _FLOW_PATH)
        flow = _imp_util.module_from_spec(spec)
        # Register BEFORE exec so flow.py's lazy `from scripts.cocoindex_pipeline
        # import …` (function-local) and any downstream reload resolve this
        # identity rather than re-triggering a path lookup.
        _sys.modules[_canonical] = flow
        spec.loader.exec_module(flow)

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
        return {"content_type": "document", "primary_domain": "procurement"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": [{"question_text": "Q?", "answer_text": "A."}]}

    async def _fake_entities(content_text: str):
        return []

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)


def _exercise_ingest(flow, fake_file, ci, qa, sd, em, run_op_id) -> None:
    """Drive a single ``ingest_file`` invocation under a ``bind_flow_meta``.

    Per ID-53.10 §P-4 the ``em_target`` is the fourth extra arg expected by
    ``ingest_file`` (declare_row body for entity_mentions ships at {53.11}).
    """
    from scripts.cocoindex_pipeline.flow_context import bind_flow_meta  # noqa: PLC0415

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


# ── bl-223 — embedding-input truncation guard (text-embedding-3-large 8192 cap) ─


class _CapturingEmbedder:
    """Async embedder fake that records the exact text `.embed()` receives.

    `embed_content_text` calls `await _get_embedder().embed(input)`; this captures
    `input` so a test can assert the truncation budget was applied BEFORE the
    (mocked) OpenAI call that would otherwise 400 at >8192 tokens. Returns a
    deterministic `dim`-length numeric vector (default 1024 = the contract width;
    a wrong width exercises the dimension guard).
    """

    def __init__(self, dim: int = 1024) -> None:
        self.dim = dim
        self.received: list[str] = []

    async def embed(self, text: str) -> list[float]:
        self.received.append(text)
        return [round((i % 5) * 0.011 - 0.02, 6) for i in range(self.dim)]


def _truncation_warn_records(caplog: pytest.LogCaptureFixture) -> list[dict]:
    """Parse `cocoindex.embedding.input_truncated` JSON soft-warns from caplog."""
    import json as _json  # noqa: PLC0415
    import logging as _logging  # noqa: PLC0415

    events: list[dict] = []
    for record in caplog.records:
        if record.levelno != _logging.WARNING:
            continue
        try:
            payload = _json.loads(record.getMessage())
        except (ValueError, TypeError):
            continue
        if payload.get("event") == "cocoindex.embedding.input_truncated":
            events.append(payload)
    return events


class TestEmbedContentTextTruncation:
    """`embed_content_text` bounds its embedding INPUT to the model token cap.

    `text-embedding-3-large` 400s at >8192 input tokens (OpenAI hard limit), so
    `embed_content_text` truncates the text passed to `.embed()` to
    EMBEDDING_INPUT_TOKEN_BUDGET (8000, headroom below 8192). bl-223.
    """

    def _budget_in_tokens(self, flow, text: str) -> int:
        """Token length of `text` under the same encoder the guard uses.

        Returns a char-budget-derived estimate when tiktoken is unavailable so
        the assertion still bounds the right quantity in either environment.
        """
        encoder = flow._get_embedding_encoder()
        if encoder is not None:
            return len(encoder.encode(text))
        # Char-fallback environment: express the char length as a token estimate.
        return int(len(text) / flow._EMBEDDING_FALLBACK_CHARS_PER_TOKEN)

    def test_oversized_input_is_truncated_below_cap_and_returns_vector(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A >8192-token body is truncated to ≤ budget; embed() never sees the cap.

        Proves: (1) `.embed()` receives ≤ EMBEDDING_INPUT_TOKEN_BUDGET tokens —
        so the OpenAI 400 cannot fire; (2) the function still returns a valid
        length-1024 vector WITHOUT raising; (3) the structured soft-warn fired.
        """
        import logging  # noqa: PLC0415

        flow = _flow_module()
        embedder = _CapturingEmbedder(dim=1024)
        monkeypatch.setattr(flow, "_get_embedder", lambda: embedder)

        # ~10k-token body: each " lorem ipsum dolor" repeat is several cl100k
        # tokens, so 4000 repeats clears the 8192 cap with margin. Char-fallback
        # environments also exceed their char budget at this length.
        oversized = (" lorem ipsum dolor sit amet" * 4000).strip()
        pre_tokens = self._budget_in_tokens(flow, oversized)
        assert pre_tokens > 8192, (
            f"test fixture must exceed the 8192-token cap; got {pre_tokens}"
        )

        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.flow"):
            values = asyncio.run(flow.embed_content_text(oversized))

        # (2) valid vector, no raise.
        assert len(values) == 1024
        assert all(isinstance(v, float) for v in values)

        # (1) the embedder received a bounded input — strictly under the 8192 cap
        # and at/under the 8000-token budget the guard targets.
        assert len(embedder.received) == 1, "embedder must be called exactly once"
        seen = embedder.received[0]
        assert seen != oversized, "embedder must receive the TRUNCATED text"
        seen_tokens = self._budget_in_tokens(flow, seen)
        assert seen_tokens <= flow.EMBEDDING_INPUT_TOKEN_BUDGET, (
            f"embedder input {seen_tokens} tokens exceeds budget "
            f"{flow.EMBEDDING_INPUT_TOKEN_BUDGET}"
        )
        assert seen_tokens < 8192, "embedder input must be strictly under the cap"

        # (3) soft-warn fired with the structured event + from/to fields.
        warns = _truncation_warn_records(caplog)
        assert len(warns) == 1, (
            f"expected exactly one input_truncated soft-warn; got {warns}"
        )
        assert warns[0]["model"] == "text-embedding-3-large"
        assert warns[0]["from_chars"] > warns[0]["to_chars"]

    def test_undersized_input_passes_through_unchanged_no_warn(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """A small body is embedded verbatim — no truncation, no soft-warn."""
        import logging  # noqa: PLC0415

        flow = _flow_module()
        embedder = _CapturingEmbedder(dim=1024)
        monkeypatch.setattr(flow, "_get_embedder", lambda: embedder)

        small = "# Heading\n\nA short document body, well under the token budget."

        with caplog.at_level(logging.WARNING, logger="scripts.cocoindex_pipeline.flow"):
            values = asyncio.run(flow.embed_content_text(small))

        assert len(values) == 1024
        # The embedder saw the ORIGINAL text byte-for-byte (no truncation).
        assert embedder.received == [small]
        # No truncation soft-warn for under-budget text.
        assert _truncation_warn_records(caplog) == [], (
            "under-budget text must not emit an input_truncated warning"
        )

    def test_dimension_guard_raises_on_wrong_width_vector(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The S270 dimension guard still raises loudly on a wrong-width vector.

        A misconfigured embedder returning its native 3072-dim (not 1024) must
        raise ValueError rather than silently writing a vector(1024)-incompatible
        value. Preserved verbatim through the bl-223 truncation change.
        """
        flow = _flow_module()
        # Native-width (3072) embedder — contract violation.
        embedder = _CapturingEmbedder(dim=3072)
        monkeypatch.setattr(flow, "_get_embedder", lambda: embedder)

        with pytest.raises(ValueError, match="embedding dimension mismatch"):
            asyncio.run(flow.embed_content_text("small body"))
