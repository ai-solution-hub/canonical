"""Tests for cocoindex_pipeline/flow.py — Subtask ID-28.16 stage_counts +
items_created population.

Verifies:

  - `_record_extraction_success()` increments stage_counts['llm_extraction']
    and appends to items_created when called per successful extractor
    invocation.
  - `_record_extraction_failure()` increments NOTHING — failed extractions
    must not bloat the success counters (the rollup webhook routes the
    failure via error_class instead).
  - `app_main()` initialises stage_counts via _empty_stage_counts() and
    items_created as an empty list, binds FLOW_META_CTX before the
    extractor invocation block, and emits the rollup webhook at flow-end
    with the populated stage_counts + items_created.
  - The wiring discipline: stage_counts['llm_extraction'] increments
    apply per-source_document_id (3 extractors fired on 1 content row → 3
    increments, items_created has 1 entry).

The cocoindex / aiohttp / asyncpg / docling modules are all stubbed at
the import boundary so the test runs WITHOUT live infrastructure.

Reference: docs/reference/task-list.json → ID-28 → Subtask 16
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

# ── Path setup ──────────────────────────────────────────────────────────────

# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ── cocoindex + dependent stubs ──────────────────────────────────────────────


def _make_coco_stub() -> MagicMock:
    stub = MagicMock(name="cocoindex")
    stub.ContextKey = MagicMock(name="ContextKey")
    stub.AppConfig = MagicMock(name="AppConfig")
    stub.App = MagicMock(name="App")
    stub.use_context = MagicMock(name="use_context")
    stub.start = MagicMock(name="start")
    return stub


def _stub_module(name: str) -> MagicMock:
    if name not in sys.modules:
        sys.modules[name] = MagicMock(name=name)
    return sys.modules[name]


from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402

_coco_stub = _make_coco_stub()
# Guarantee a working `@coco.fn` so flow.py's `extraction` import keeps
# `extract_classification` awaitable regardless of import order (ID-44.5).
_coco_stub.fn = passthrough_coco_fn
_localfs_stub = MagicMock(name="cocoindex.connectors.localfs")
_pg_stub = MagicMock(name="cocoindex.connectors.postgres")
_pg_stub.ColumnDef = MagicMock(name="ColumnDef")
_pg_stub.TableSchema = MagicMock(name="TableSchema")
_pg_stub.mount_table_target = MagicMock(name="mount_table_target")
_connectorkits_stub = MagicMock(name="cocoindex.connectorkits")
_target_stub = MagicMock(name="cocoindex.connectorkits.target")
_target_stub.ManagedBy = MagicMock(name="ManagedBy")
# asyncpg + docling are inert (no process-global state, no real-package
# consumer) so they stay resident in sys.modules.
_stub_module("asyncpg")
_stub_module("docling")
_stub_module("docling.document_converter")


# ── aiohttp stub ─────────────────────────────────────────────────────────────


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


_aiohttp_stub = MagicMock(name="aiohttp")
_aiohttp_stub.ClientSession = _StubSession
_aiohttp_stub.ClientTimeout = MagicMock(name="ClientTimeout")


# ── Import the module under test ─────────────────────────────────────────────
# cocoindex (+ connector submodules) and aiohttp register / shadow
# process-global state, so they are scoped to this import via
# `stubbed_sys_modules()` and removed from sys.modules afterwards (ID-44.5).
# `flow` captures the stub references at import time; the cooperative
# `flow.aiohttp` pin below re-asserts the aiohttp stub on the flow module
# attribute (independent of sys.modules), so the webhook-payload introspection
# tests keep working.
with stubbed_sys_modules(
    {
        "cocoindex": _coco_stub,
        "cocoindex.connectors": MagicMock(name="cocoindex.connectors"),
        "cocoindex.connectors.localfs": _localfs_stub,
        "cocoindex.connectors.postgres": _pg_stub,
        "cocoindex.connectorkits": _connectorkits_stub,
        "cocoindex.connectorkits.target": _target_stub,
        "aiohttp": _aiohttp_stub,
    }
):
    from scripts.cocoindex_pipeline import flow  # noqa: E402  (stub-scoped import)

# Cooperative-pin discipline (mirrors the explicit guidance in
# test_cocoindex_flow_failure_mode.py module docstring):
# `test_cocoindex_flow_pipeline_run_webhook.py` ALSO defines a _StubSession
# class and pins `flow.aiohttp` at module-import time. If both files'
# import-time pins fire, the LAST one wins — and the webhook test reads
# its OWN `_StubSession.last_json` class reference, so a wrong-pin run
# silently loses payloads.
#
# We do NOT unconditionally pin `flow.aiohttp` from this file. We pin
# ONLY when nothing has pinned yet (`flow.aiohttp is None` or the
# original real-aiohttp module). Then the webhook-emission tests below
# cooperate by introspecting whichever `flow.aiohttp.ClientSession` is
# in residence — both this file's _StubSession and the sibling
# files' _StubSession classes expose the same surface (`last_json`,
# `last_url`, `last_headers`, `next_response_status`, `reset()`).
_existing = getattr(flow, "aiohttp", None)
if _existing is None or not isinstance(_existing, MagicMock):
    flow.aiohttp = _aiohttp_stub


# ============================================================================
# STAGE COUNTS + ITEMS CREATED HELPERS (28.16 substrate)
# ============================================================================


class TestRecordExtractionSuccess:
    """`_record_extraction_success()` increments llm_extraction + items_created."""

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_record_extraction_success")
        assert callable(flow._record_extraction_success)

    def test_increments_llm_extraction_stage_count(self):
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        source_document_id = uuid.uuid4()
        flow._record_extraction_success(
            stage_counts=stage_counts,
            items_created=items_created,
            source_document_id=source_document_id,
        )
        assert stage_counts["llm_extraction"] == 1

    def test_appends_to_items_created(self):
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        source_document_id = uuid.uuid4()
        flow._record_extraction_success(
            stage_counts=stage_counts,
            items_created=items_created,
            source_document_id=source_document_id,
        )
        assert items_created == [str(source_document_id)]

    def test_multiple_calls_accumulate(self):
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        ids = [uuid.uuid4() for _ in range(3)]
        for cid in ids:
            flow._record_extraction_success(
                stage_counts=stage_counts,
                items_created=items_created,
                source_document_id=cid,
            )
        assert stage_counts["llm_extraction"] == 3
        assert items_created == [str(cid) for cid in ids]

    def test_does_not_touch_other_stage_counts(self):
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        flow._record_extraction_success(
            stage_counts=stage_counts,
            items_created=items_created,
            source_document_id=uuid.uuid4(),
        )
        # Only llm_extraction incremented; the other 6 stages remain zero.
        assert stage_counts["source_walk"] == 0
        assert stage_counts["binary_conversion"] == 0
        assert stage_counts["embedding"] == 0
        assert stage_counts["entity_resolution"] == 0
        assert stage_counts["chunking"] == 0
        assert stage_counts["postgres_upsert"] == 0

    def test_dedupes_items_created_on_repeated_source_document_id(self):
        """The 3-extractor pattern (classification + qa_form + entity_mentions)
        fires THREE times per content_items row — but `items_created` is the
        set of source_document_id values for the run, so each row should
        appear exactly ONCE in the list (per Inv-4 idempotency)."""
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        row_id = uuid.uuid4()
        # Simulate 3 extractors firing on the same content row
        for _ in range(3):
            flow._record_extraction_success(
                stage_counts=stage_counts,
                items_created=items_created,
                source_document_id=row_id,
            )
        # stage_counts['llm_extraction'] reflects ALL 3 extraction passes
        assert stage_counts["llm_extraction"] == 3
        # items_created has the row ID once (3 extractors fired on 1 row)
        assert items_created == [str(row_id)]


class TestRecordExtractionFailure:
    """`_record_extraction_failure()` increments NOTHING — failure routing
    goes via error_class on the rollup webhook, NOT via stage_counts."""

    def test_helper_function_is_exposed(self):
        assert hasattr(flow, "_record_extraction_failure")
        assert callable(flow._record_extraction_failure)

    def test_does_not_increment_llm_extraction(self):
        stage_counts = flow._empty_stage_counts()
        items_created: list[str] = []
        flow._record_extraction_failure(
            stage_counts=stage_counts,
            items_created=items_created,
            source_document_id=uuid.uuid4(),
        )
        # Failed extractions DO NOT increment llm_extraction — that counter
        # is success-only; failures route through error_class on the
        # rollup webhook.
        assert stage_counts["llm_extraction"] == 0
        assert items_created == []


# ============================================================================
# app_main() FLOW_META_CTX binding contract
# ============================================================================


class TestAppMainFlowMetaCtxBinding:
    """`app_main()` binds FLOW_META_CTX before extractor invocation.

    The brief acceptance:
      "FLOW_META_CTX bound at app_main; every emitted extracted row carries
       op_id + source_document_id + extracted_at via stamp_extraction_base."

    This test exercises the idle-mode early-return path (COCOINDEX_SOURCE_PATH
    unset) — confirms the binding wiring is in place WITHOUT booting the
    cocoindex Rust engine. The live-binding path is exercised end-to-end by
    the 28.14 integration test.
    """

    def test_app_main_imports_bind_flow_meta(self):
        """flow.py must import bind_flow_meta from flow_context — this is
        the helper that wraps the extractor-invocation block.
        """
        # The helper is module-level on flow; whether it's a direct import
        # or fetched via importlib at the call-site, the symbol must be
        # reachable.
        assert hasattr(flow, "bind_flow_meta") or hasattr(
            flow, "current_flow_meta"
        ), (
            "flow.py must expose flow_context.bind_flow_meta and/or "
            "current_flow_meta — at minimum one of them so the wiring "
            "discipline is visible at the call site."
        )

    def test_app_main_idle_mode_does_not_raise(self, monkeypatch):
        """The 28.16 wiring must NOT break the existing 28.12 WP4 idle-mode
        contract: app_main() returns cleanly when COCOINDEX_SOURCE_PATH is
        unset.
        """
        monkeypatch.delenv("COCOINDEX_SOURCE_PATH", raising=False)
        # Should not raise.
        asyncio.run(flow.app_main())


# ============================================================================
# Rollup webhook receives populated stage_counts + items_created
# ============================================================================


class TestRollupWebhookReceivesStageCountsAndItemsCreated:
    """The flow-end webhook emission carries the populated stage_counts +
    items_created per the brief acceptance.

    We exercise the helper layer directly (not the live cocoindex flow
    execution): assemble a populated stage_counts + items_created, invoke
    `_emit_pipeline_run_webhook()`, assert the wire shape carries both.

    Cooperates with sibling test files' aiohttp stubs by introspecting
    whichever `flow.aiohttp.ClientSession` is in residence (see module-
    level comment on the pin) — both this file's _StubSession and the
    sibling test files' _StubSession classes expose the same surface.
    """

    def setup_method(self):
        # Reset whichever stub is currently active on flow.aiohttp.
        active_stub = flow.aiohttp.ClientSession
        if hasattr(active_stub, "reset"):
            active_stub.reset()

    def test_webhook_payload_includes_stage_counts(self, monkeypatch):
        monkeypatch.setenv("PIPELINE_RUN_WEBHOOK_URL", "https://example.test/x")
        monkeypatch.setenv("CRON_SECRET", "test-secret")

        stage_counts = flow._empty_stage_counts()
        stage_counts["llm_extraction"] = 7

        async def _emit():
            await flow._emit_pipeline_run_webhook(
                op_id=uuid.uuid4(),
                status="completed",
                stage_counts=stage_counts,
                items_processed=5,
                items_created=[],
            )

        asyncio.run(_emit())
        # Read from the active stub (cooperative with sibling tests'
        # _StubSession classes).
        active_stub = flow.aiohttp.ClientSession
        payload = active_stub.last_json
        assert payload is not None, (
            f"webhook stub captured no payload; active stub is "
            f"{type(active_stub).__name__!r}"
        )
        assert payload["stageCounts"]["llm_extraction"] == 7

    def test_webhook_payload_includes_items_created(self, monkeypatch):
        monkeypatch.setenv("PIPELINE_RUN_WEBHOOK_URL", "https://example.test/x")
        monkeypatch.setenv("CRON_SECRET", "test-secret")

        items_created = [str(uuid.uuid4()) for _ in range(3)]

        async def _emit():
            await flow._emit_pipeline_run_webhook(
                op_id=uuid.uuid4(),
                status="completed",
                stage_counts=flow._empty_stage_counts(),
                items_processed=3,
                items_created=items_created,
            )

        asyncio.run(_emit())
        active_stub = flow.aiohttp.ClientSession
        payload = active_stub.last_json
        assert payload is not None, (
            f"webhook stub captured no payload; active stub is "
            f"{type(active_stub).__name__!r}"
        )
        assert payload["itemsCreated"] == items_created
