"""Inv-17 embedding stage-counter wiring (ID-49.4 — folded-in observability fix).

Proves the embedding stage counter closes the Inv-17 gap inherited from
ID-49.2: `stage_counts["embedding"]` was initialised to 0 by
`_empty_stage_counts()` but NEVER incremented, so it stayed permanently 0
regardless of how many embeddings the pipeline produced. The flow-end
webhook therefore reported a falsely-empty embedding count.

The fix mirrors the EXISTING `bind_retry_counter` / `_FlowRetryCounter`
contextvar pattern (flow_context.py + flow.py): a flow-scope-bound stage
counter that `ingest_file` increments when `embed_content_text` produces a
vector, read back by `app_main` at webhook-emit so `stage_counts["embedding"]`
surfaces truthfully.

{127.25}/{127.26} DR-034/DR-036 UPDATE: SLICE 2 (`TestIngestFileBumpsEmbeddingCounter`,
renamed `TestIngestFileEmbeddingCounterRetiredForContentBranch`) no longer proves a
bump — the whole-document embedding write it modelled is RETIRED, not re-pointed
(`content_items` and its `embedding` column are dropped entirely; no other
content-branch target gained one). The counter SUBSTRATE (SLICE 1) and the
`app_main` threading/folding wiring (SLICE 3) are UNCHANGED and still live —
but the embedding stage counter itself currently bumps ONLY on the
reference_item/URL branch (`_ingest_url_body`, flow.py:3827). The per-chunk
path computes embeddings (`embed_content_text`, flow.py:2302) but does NOT
bump `stage_counts["embedding"]` — it bumps only `stage_counts["chunking"]`
(flow.py:2346). Neither path is exercised by this file's minimal
(qa, sd, em)-only `ingest_file` calls. SLICE 2 now guards the NEGATIVE: a
minimal content ingest must NOT bump `stage_counts["embedding"]`.

WHAT THIS PROVES (ID-49.4 — Inv-17 embedding counter):
  - `flow_context.bind_stage_counter` / `current_stage_counter` form a
    bind/read pair sharing one ContextVar identity (the dual-import-path
    hazard guarded in flow_context.py applies equally here).
  - `ingest_file`'s content branch, called WITHOUT a `cc_target` (no
    chunking), does NOT bump the embedding stage counter — the
    document-level embedding write is retired (DR-034); the counter
    currently bumps ONLY on the reference_item/URL branch
    (`_ingest_url_body`, flow.py:3827) — the per-chunk path computes
    embeddings but bumps `stage_counts["chunking"]`, not `["embedding"]`.
  - `app_main` source binds the stage counter around `mount_each` and folds
    its value into `stage_counts["embedding"]` before the flow-end webhook
    emit — verified by source-inspection (the cocoindex Rust engine cannot
    boot in unit tests, so the live binding is proven by the same
    source-inspection discipline used for the retry-counter wiring in
    test_cocoindex_app_main_retry_wiring.py SLICE 2).
  - The flow-end webhook payload carries the bumped embedding count as
    `stageCounts["embedding"]`.

Async tests follow the repo convention (no pytest-asyncio plugin): drive
coroutines via `asyncio.run` inside sync test functions. The cocoindex stub
uses the robust POP-THEN-FRESH-IMPORT pattern (NOT importlib.reload — the
reload form is fragile under cross-file collection order, ID-49.7).

Reference: docs/reference/task-list.json → ID-49 → Subtask 4;
PRODUCT.md Inv-17; RESEARCH §R7 (layered observability substrate).
"""

from __future__ import annotations

import asyncio
import inspect
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import pytest


# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

# ID-101 §{101.7}: neutralise the relationship-extraction Path-A seam so
# ingest_file tests make no live Anthropic call (mirrors the
# extract_entity_mentions stubs alongside).
async def _fake_relationships_empty(content_text: str) -> list:
    return []



# ── cocoindex stub install (mirrors test_cocoindex_flow_embedding.py) ─────────


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


# ── aiohttp stub for webhook payload capture ──────────────────────────────────


class _StubResponse:
    def __init__(self, status: int = 200, body: str = "ok"):
        self.status = status
        self._body = body

    async def text(self) -> str:
        return self._body

    async def __aenter__(self) -> "_StubResponse":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class _StubSession:
    last_url: str | None = None
    last_headers: dict[str, str] | None = None
    last_json: dict[str, object] | None = None
    next_response_status: int = 200
    next_response_body: str = "ok"

    @classmethod
    def reset(cls) -> None:
        cls.last_url = None
        cls.last_headers = None
        cls.last_json = None
        cls.next_response_status = 200
        cls.next_response_body = "ok"

    async def __aenter__(self) -> "_StubSession":
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def post(self, url, *, json=None, headers=None, timeout=None):  # noqa: ANN001
        _StubSession.last_url = url
        _StubSession.last_headers = headers
        _StubSession.last_json = json
        return _StubResponse(
            status=_StubSession.next_response_status,
            body=_StubSession.next_response_body,
        )


def _flow_module():
    """Load flow under this file's stubbed cocoindex (per-file pop-then-import).

    Pops any resident `cocoindex_pipeline.flow` AND `scripts.cocoindex_pipeline.flow`
    first, then imports FRESH under the stubs — the robust pop-then-fresh-import
    pattern (NOT importlib.reload, which raises `module not in sys.modules` under
    adverse collection order; ID-49.7 reload-isolation fragility).
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
    aiohttp_stub = MagicMock(name="aiohttp")
    aiohttp_stub.ClientSession = _StubSession
    aiohttp_stub.ClientTimeout = MagicMock(name="ClientTimeout")
    stubs = {
        "cocoindex": coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": localfs_stub,
        "cocoindex.connectors.postgres": pg_stub,
        "cocoindex.connectorkits": MagicMock(name="cocoindex.connectorkits"),
        "cocoindex.connectorkits.target": target_stub,
        "aiohttp": aiohttp_stub,
        "docling": MagicMock(name="docling"),
        "docling.document_converter": MagicMock(name="docling.document_converter"),
    }
    _sys.modules.pop("cocoindex_pipeline.flow", None)
    _sys.modules.pop("scripts.cocoindex_pipeline.flow", None)

    with stubbed_sys_modules(stubs):
        from scripts.cocoindex_pipeline import flow  # noqa: PLC0415

    # NB: we deliberately do NOT pin `flow.aiohttp` here. The sibling webhook
    # test (test_cocoindex_flow_pipeline_run_webhook.py) pins its OWN
    # _StubSession onto the resident flow module at collection time; an
    # unconditional pin here would overwrite that and strand its payload
    # capture (ID-49.7 cross-file leak). The single webhook-payload test in
    # this file (SLICE 4) pins + restores `flow.aiohttp` locally instead.
    return flow


# ── Fakes (mirror test_cocoindex_flow_embedding.py) ──────────────────────────


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
        import hashlib  # noqa: PLC0415

        return hashlib.sha256(self._path.read_bytes()).digest()


_MARKDOWN = "# Heading\n\nHello world body text for embedding."


def _patch_pipeline(flow, monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the P-3 adapter, Path A extractors, and embedder seam."""

    async def _fake_convert(file: object) -> str:
        return _MARKDOWN

    async def _fake_classification(content_text: str):
        return {"content_type": "case_study", "primary_domain": "procurement"}

    async def _fake_qa(content_text: str):
        return {"qa_pairs": []}

    async def _fake_entities(content_text: str):
        return []

    async def _fake_embed(content_text: str) -> list[float]:
        return [round((i % 5) * 0.011 - 0.02, 6) for i in range(1024)]

    monkeypatch.setattr(flow, "convert_binary_to_markdown", _fake_convert)
    monkeypatch.setattr(flow, "extract_classification", _fake_classification)
    monkeypatch.setattr(flow, "extract_qa_form", _fake_qa)
    monkeypatch.setattr(flow, "extract_entity_mentions", _fake_entities)
    monkeypatch.setattr(flow, "extract_relationships", _fake_relationships_empty)
    monkeypatch.setattr(flow, "embed_content_text", _fake_embed)


def _make_targets() -> tuple[_FakeTarget, _FakeTarget, _FakeTarget]:
    """{127.25} DR-034: `content_items` was dropped and `ci_target` removed
    from `ingest_file`'s signature — the per-doc target set is now 3
    (qa, sd, em); was 4 (ci, qa, sd, em) per ID-53.10 §P-4."""
    return (
        _FakeTarget("q_a_extractions"),
        _FakeTarget("source_documents"),
        _FakeTarget("entity_mentions"),
    )


# ============================================================================
# SLICE 1: flow_context exposes a bind/read pair for the stage counter
# ============================================================================


class TestStageCounterBindingSubstrate:
    """`bind_stage_counter` / `current_stage_counter` form a ContextVar pair
    with a single identity — the same substrate shape as the retry counter."""

    def test_flow_exposes_bind_stage_counter(self) -> None:
        flow = _flow_module()
        assert hasattr(flow, "bind_stage_counter"), (
            "flow.py must import bind_stage_counter from flow_context — the "
            "binding context manager wires the per-flow embedding counter into "
            "the contextvar that ingest_file reads. Without it, "
            "stage_counts['embedding'] stays permanently 0."
        )

    def test_bind_stage_counter_round_trips_inside_scope(self) -> None:
        """current_stage_counter() inside the binding returns the bound counter;
        outside the binding it returns None (token reset on exit).

        Bind + read MUST resolve to the SAME flow_context namespace that
        `ingest_file` reads under (`flow.__package__`.flow_context) — mixing
        the `scripts.cocoindex_pipeline.*` and `cocoindex_pipeline.*` package
        paths in one process is the dual-import-path hazard documented in
        flow_context.py: two `_stage_counter_var` instances, bind and read
        diverging. Production boots under one namespace
        (`python3 -m scripts.cocoindex_pipeline`) so the pair always agrees.
        """
        flow = _flow_module()
        import importlib  # noqa: PLC0415

        # Resolve flow_context via flow's OWN package — the SAME module
        # `ingest_file` reads `current_stage_counter()` from.
        flow_context = importlib.import_module(f"{flow.__package__}.flow_context")

        counter = flow._FlowStageCounter()

        async def _exercise() -> tuple[object | None, object | None]:
            async with flow_context.bind_stage_counter(counter):
                inside = flow_context.current_stage_counter()
            outside = flow_context.current_stage_counter()
            return inside, outside

        inside, outside = asyncio.run(_exercise())
        assert inside is counter, (
            "current_stage_counter() inside the binding must return the bound "
            "counter; a divergent identity means the bind/read pair use "
            "different ContextVar instances (dual-import-path hazard) and the "
            "production bump would silently miss."
        )
        assert outside is None, (
            "current_stage_counter() outside the binding must return None."
        )


# ============================================================================
# SLICE 2: ingest_file bumps the bound embedding counter once per embedding
# ============================================================================


class TestIngestFileEmbeddingCounterRetiredForContentBranch:
    """{127.25} DR-034: `ingest_file`'s content branch, called with only the
    minimal (qa, sd, em) target set (no `cc_target`), no longer produces or
    declares any document-level embedding — so it must NOT bump the
    'embedding' stage counter either. The embedding stage counter currently
    bumps ONLY on the reference_item/URL branch (`_ingest_url_body`,
    flow.py:3827); the per-chunk path computes embeddings
    (`embed_content_text`, flow.py:2302) but does not bump
    `stage_counts["embedding"]` — only `stage_counts["chunking"]`
    (flow.py:2346). Neither path is exercised here. Was
    `TestIngestFileBumpsEmbeddingCounter` (proved a bump of exactly 1 per
    ingest) before the retirement."""

    def test_one_ingest_does_not_bump_embedding_counter(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        _patch_pipeline(flow, monkeypatch)
        # Bind via the canonical package namespace — the SAME flow_context module
        # `ingest_file` reads `current_stage_counter()` from.
        # `scripts.cocoindex_pipeline.flow_context` matches `flow.__package__`
        # after ID-67 namespace canonicalisation.
        from scripts.cocoindex_pipeline.flow_context import (  # noqa: PLC0415
            bind_flow_meta,
            bind_stage_counter,
        )

        src = tmp_path / "doc-embed-count.md"
        src.write_text(_MARKDOWN)
        fake_file = _FakeFile(src)
        qa, sd, em = _make_targets()
        counter = flow._FlowStageCounter()

        async def _run() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_stage_counter(counter):
                    await flow.ingest_file(fake_file, qa, sd, em, None, None)

        asyncio.run(_run())

        assert counter.get("embedding") == 0, (
            f"{{127.25}} DR-034: ingest_file's content branch (no cc_target) "
            f"must NOT bump stage_counts['embedding'] — the document-level "
            f"embedding write is retired; got {counter.get('embedding')}. A "
            f"non-zero count here means the retired write was silently "
            f"reintroduced."
        )

    def test_two_ingests_still_leave_embedding_counter_at_zero(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Two separate ingest_file passes inside one binding scope still
        leave the embedding counter at 0 — the per-item fan-out no longer
        touches 'embedding' at all for the content branch."""
        flow = _flow_module()
        _patch_pipeline(flow, monkeypatch)
        from scripts.cocoindex_pipeline.flow_context import (  # noqa: PLC0415
            bind_flow_meta,
            bind_stage_counter,
        )

        counter = flow._FlowStageCounter()

        async def _run() -> None:
            async with bind_flow_meta(op_id=uuid.uuid4()):
                async with bind_stage_counter(counter):
                    for name in ("a.md", "b.md"):
                        src = tmp_path / name
                        src.write_text(_MARKDOWN + f"\n\n{name}")
                        qa, sd, em = _make_targets()
                        await flow.ingest_file(_FakeFile(src), qa, sd, em, None, None)

        asyncio.run(_run())
        assert counter.get("embedding") == 0

    def test_no_binding_still_ingests_without_embedding_stage(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Without bind_stage_counter, ingest_file still completes cleanly.
        The content branch's document-level embedding write is retired
        (DR-034), so there is no embedding-specific graceful-degradation
        behaviour left to prove — this guards that omitting the binding
        does not raise, and that no spurious rows land on qa/em."""
        flow = _flow_module()
        _patch_pipeline(flow, monkeypatch)
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta  # noqa: PLC0415

        src = tmp_path / "doc-no-binding.md"
        src.write_text(_MARKDOWN)
        qa, sd, em = _make_targets()

        async def _run() -> None:
            # Deliberately NO bind_stage_counter — ingest_file must cope.
            async with bind_flow_meta(op_id=uuid.uuid4()):
                await flow.ingest_file(_FakeFile(src), qa, sd, em, None, None)

        asyncio.run(_run())
        # _patch_pipeline's fake qa_form/entities extractors return empty
        # collections, so nothing lands on either target — this also
        # confirms ingest_file did not raise.
        assert qa.rows == []
        assert em.rows == []


# ============================================================================
# SLICE 3: app_main wires the embedding counter into stage_counts (source)
# ============================================================================


class TestAppMainWiresEmbeddingCounter:
    """app_main binds the stage counter around mount_each and folds its value
    into stage_counts['embedding'] before the flow-end webhook emit.

    Source-inspection is the canonical pattern (mirrors the retry-counter
    wiring test SLICE 2) because the cocoindex Rust engine cannot be booted
    in unit tests, so app_main() cannot run end-to-end.
    """

    def test_app_main_binds_stage_counter(self) -> None:
        """ID-66.19: the stage counter is THREADED onto ingest_file, not bound at
        flow scope — cocoindex runs ingest_file on its own daemon thread which
        does not inherit app_main's ContextVar bindings. app_main passes
        `flow_stage_counter=flow_stage_counter` via functools.partial and
        ingest_file reads it directly from the arg."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "flow_stage_counter=flow_stage_counter" in source, (
            "app_main() must thread `flow_stage_counter=flow_stage_counter` onto "
            "ingest_file (via functools.partial) so the per-flow _FlowStageCounter "
            "crosses the cocoindex daemon-thread boundary and ingest_file can bump "
            "it. Without it, production runs emit stageCounts['embedding']=0 even "
            "when embeddings were produced."
        )

    def test_app_main_uses_async_with_for_stage_binding(self) -> None:
        """ID-66.19 + {66.16}: app_main threads the run context onto ingest_file
        via a NAMED closure (NOT functools.partial — a partial has no
        __name__/__qualname__ and crashes cocoindex mount_each; the bind point
        still moves off app_main's wrong thread)."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "async def bound_ingest_file(" in source, (
            "app_main() must thread the stage counter (+ the rest of the run "
            "context) onto a NAMED per-item closure across the cocoindex "
            "daemon-thread boundary (not functools.partial — {66.16})."
        )
        assert "flow_stage_counter=" in source, (
            "the closure must forward flow_stage_counter into ingest_file."
        )

    def test_app_main_folds_embedding_count_into_stage_counts(self) -> None:
        """app_main must read the bound counter back into stage_counts['embedding']
        so the flow-end webhook surfaces it. Verified by source-inspection:
        the counter's embedding value is assigned into stage_counts before emit."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert 'stage_counts["embedding"]' in source, (
            "app_main() must assign the bound embedding counter back into "
            "stage_counts['embedding'] before the flow-end webhook emit — "
            "otherwise the counter bumps but the webhook still reports 0."
        )


# ============================================================================
# SLICE 4: flow-end webhook payload carries the embedding count
# ============================================================================


class TestWebhookPayloadCarriesEmbeddingCount:
    """End-to-end-ish: a populated stage_counts['embedding'] surfaces in the
    flow-end webhook payload as stageCounts['embedding']."""

    def test_webhook_payload_includes_embedding_count(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        monkeypatch.setenv("PIPELINE_RUN_WEBHOOK_URL", "https://example.test/x")
        monkeypatch.setenv("CRON_SECRET", "test-secret")

        # Pin THIS file's aiohttp stub locally + restore on exit so we don't
        # strand the sibling webhook test's _StubSession capture (ID-49.7).
        local_aiohttp = MagicMock(name="aiohttp")
        local_aiohttp.ClientSession = _StubSession
        local_aiohttp.ClientTimeout = MagicMock(name="ClientTimeout")
        prior_aiohttp = getattr(flow, "aiohttp", None)
        flow.aiohttp = local_aiohttp
        _StubSession.reset()

        # Model the post-fix state: app_main folded the counter into stage_counts.
        stage_counts = flow._empty_stage_counts()
        stage_counts["embedding"] = 3

        async def _emit() -> None:
            await flow._emit_pipeline_run_webhook(
                op_id=uuid.uuid4(),
                status="completed",
                stage_counts=stage_counts,
                items_processed=3,
                items_created=[],
            )

        try:
            asyncio.run(_emit())
            payload = _StubSession.last_json
        finally:
            if prior_aiohttp is not None:
                flow.aiohttp = prior_aiohttp

        assert payload is not None, "expected a webhook POST; got None"
        assert payload["stageCounts"]["embedding"] == 3, (
            f"webhook payload must surface stageCounts['embedding']=3; got "
            f"{payload['stageCounts'].get('embedding')!r}. This is the Inv-17 "
            f"observability contract — the count must reach the webhook receiver."
        )


# ============================================================================
# SLICE 5: idle-mode safety — the new binding must not break early return
# ============================================================================


class TestIdleModeContractPreserved:
    """The new stage-counter binding must not introduce a raise on the
    COCOINDEX_SOURCE_PATH-unset early-return path."""

    def test_app_main_idle_mode_does_not_raise(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        flow = _flow_module()
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        # Must return cleanly — the early-return guard fires before any
        # cocoindex / stage-counter construction.
        asyncio.run(flow.app_main())


# ============================================================================
# SLICE 6: layered-retry reality — NO per-row Postgres retry primitive
# ============================================================================


class TestLayeredRetryRealityNoPostgresRetry:
    """ID-49.4 Part-1 retry-reality alignment (RESEARCH §R7, PRODUCT Inv-23,
    OQ-E RATIFIED FINAL). The testStrategy requires asserting NO retry
    primitive is expected from the postgres path — the ONLY KH-owned retry
    surface is the Anthropic tenacity wrapper (`_anthropic_retry`) in
    extraction.py. flow.py's Postgres write path (mount_table_target /
    declare_row) wraps NOTHING in a retry.

    These guard the layered reality: if a future change smuggles a tenacity
    import or retry decorator into flow.py's PG path, OQ-E would be silently
    violated. Behaviour-anchored: we assert the WRITE PATH carries no retry
    primitive, not an implementation incidental.
    """

    def test_flow_module_imports_no_retry_primitive(self) -> None:
        """flow.py must NOT import tenacity (or any retry decorator). The PG
        write path is retry-free by design (OQ-E); the LLM retry lives in
        extraction.py, not here."""
        flow = _flow_module()
        flow_source = inspect.getsource(flow)
        assert "import tenacity" not in flow_source, (
            "flow.py must NOT import tenacity — there is ZERO per-row Postgres "
            "retry (OQ-E RATIFIED FINAL). The only KH retry primitive is the "
            "Anthropic tenacity wrapper in extraction.py."
        )
        assert "AsyncRetrying" not in flow_source, (
            "flow.py must NOT construct a tenacity AsyncRetrying — the PG write "
            "path (mount_table_target / declare_row) is retry-free by design."
        )

    def test_ingest_file_pg_write_path_has_no_retry_wrapper(self) -> None:
        """The Stage-6 declare_row write path inside ingest_file is a plain
        call — no retry loop, no `for attempt in ...`, no backoff. A transient
        PG failure surfaces as a component exception cocoindex re-attempts on
        the next update cycle (RESEARCH §R7), NOT an in-run per-row retry."""
        flow = _flow_module()
        ingest_source = inspect.getsource(flow.ingest_file)
        # The declare_row calls are present (the write path exists)...
        assert "declare_row" in ingest_source, (
            "ingest_file must declare rows — the Stage-6 write path"
        )
        # ...but no retry construct wraps them.
        assert "AsyncRetrying" not in ingest_source
        assert "retry_if_exception_type" not in ingest_source
        assert "for attempt in" not in ingest_source, (
            "ingest_file's PG write path must have NO retry loop — per-row "
            "Postgres retry is explicitly out of scope (OQ-E)."
        )

    def test_only_anthropic_wrapper_owns_retry(self) -> None:
        """The single KH-owned retry primitive lives in extraction.py
        (`_anthropic_retry`), wrapping the Path A LLM calls only. Confirms the
        retry-counter the flow-end webhook reads (`flow_retry_counter`) is fed
        EXCLUSIVELY by Anthropic-503 retries, never a PG retry."""
        from scripts.cocoindex_pipeline import extraction  # noqa: PLC0415

        assert hasattr(extraction, "_anthropic_retry"), (
            "extraction.py must expose _anthropic_retry — the operative LLM "
            "retry for Path A (the only KH retry primitive)."
        )
        # The flow-end webhook's retry_count is fed by the flow retry counter,
        # which the Anthropic wrapper's before_sleep hook bumps — never the PG
        # path. Assert the counter type exposes only increment/get (no
        # per-stage / per-row PG hook).
        flow = _flow_module()
        counter = flow._FlowRetryCounter()
        assert counter.get() == 0, "fresh retry counter baseline is 0"
        counter.increment()
        assert counter.get() == 1, (
            "the retry counter is bumped only by the Anthropic wrapper's "
            "before_sleep hook; a value > 0 reflects REAL tenacity activity, "
            "not a PG retry (which does not exist)."
        )
