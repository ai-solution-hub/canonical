"""Tests for flow.py's ID-132 {132.16} G-TRIGGER wiring — producer
post-walk chaining.

Per the {132.16} testStrategy: post-walk hook fires the producer when
source_documents change; manual invocation still works; no double-fire;
the hook is a no-op when nothing changed (delta-only, v3 §7.2).

`producer/trigger.py`'s OWN dispatch-logic unit tests live in
`test_producer_trigger.py`. This file covers the flow.py HALF of the
wiring only:

  - `_fetch_source_document_deltas` (the new, separately-testable helper
    that reads back the op_id-scoped `source_documents` delta) — exercised
    directly against a fake pool, no cocoindex engine needed.
  - `app_main`'s hook call site — verified by SOURCE-INSPECTION (the real
    cocoindex Rust engine cannot boot in unit tests, so `app_main` cannot
    run end-to-end; mirrors `test_cocoindex_flow_embedding_stage_count.py`
    SLICE 3 / `test_cocoindex_app_main_retry_wiring.py`'s established
    pattern): the hook fires exactly once, is gated on
    `flow_status == "completed"`, and is wrapped so a producer-chain fault
    cannot fail the ingest walk itself.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from conftest import passthrough_coco_fn, stubbed_sys_modules  # noqa: E402


# ── cocoindex stub install (mirrors test_cocoindex_flow_embedding_stage_count.py) ──


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
    """Load flow under this file's stubbed cocoindex (per-file pop-then-import).

    Mirrors `test_cocoindex_flow_embedding_stage_count.py`'s `_flow_module`
    helper exactly (not shared via conftest — each flow-importing test file
    owns its own copy per the established convention).
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
    aiohttp_stub.ClientSession = MagicMock(name="ClientSession")
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

    return flow


# ============================================================================
# _fetch_source_document_deltas — the delta signal
# ============================================================================


class _FakePool:
    def __init__(self, rows: "list[Any]") -> None:
        self.rows = rows
        self.calls: "list[tuple[str, tuple[Any, ...]]]" = []

    async def fetch(self, query: str, *args: Any) -> "list[Any]":
        self.calls.append((query, args))
        return self.rows


class TestFetchSourceDocumentDeltas:
    def test_returns_rows_scoped_to_op_id(self) -> None:
        flow = _flow_module()
        rows = [{"id": "sd-1", "logical_path": "a.pdf"}]
        pool = _FakePool(rows)
        op_id = "op-123"

        result = asyncio.run(flow._fetch_source_document_deltas(pool, op_id))

        assert result == rows
        assert len(pool.calls) == 1
        query, args = pool.calls[0]
        assert "source_documents" in query
        assert "op_id" in query
        assert args == (op_id,)

    def test_empty_when_pool_returns_no_rows(self) -> None:
        flow = _flow_module()
        pool = _FakePool([])

        result = asyncio.run(flow._fetch_source_document_deltas(pool, "op-456"))

        assert result == []


# ============================================================================
# app_main — hook-site wiring (source-inspection; cocoindex engine cannot
# boot in unit tests, mirrors the retry-counter / embedding-stage-count
# wiring tests' established discipline)
# ============================================================================


class TestAppMainWiresProducerTrigger:
    def test_app_main_calls_the_delta_fetch_helper(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "_fetch_source_document_deltas(" in source, (
            "app_main() must call _fetch_source_document_deltas to obtain the "
            "op_id-scoped source_documents delta signal for the producer trigger."
        )

    def test_app_main_calls_trigger_producer_post_walk(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        assert "trigger_producer_post_walk(" in source, (
            "app_main() must call producer.trigger.trigger_producer_post_walk "
            "with the walk's op_id + source_document deltas."
        )
        # Exactly one call site — no double-fire from two independent hooks.
        assert source.count("trigger_producer_post_walk(") == 1

    def test_hook_is_gated_on_completed_status(self) -> None:
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        gate_idx = source.find('flow_status == "completed"')
        hook_idx = source.find("trigger_producer_post_walk(")
        assert gate_idx != -1, (
            "the producer-chain hook must be gated on flow_status == 'completed' "
            "— a failed walk's source_documents delta may be partial/inconsistent."
        )
        assert gate_idx < hook_idx, (
            "the completed-status gate must precede the trigger_producer_post_walk "
            "call site."
        )

    def test_hook_is_contained_and_does_not_re_raise(self) -> None:
        """A producer-chain fault must never fail the ingest walk itself — the
        walk already landed by the time this post-pass runs. Verified the same
        way the qa_dedup_proposer post-pass containment is proven: the hook's
        call site sits inside a try/except that does NOT re-raise."""
        flow = _flow_module()
        source = inspect.getsource(flow.app_main)
        hook_idx = source.find("trigger_producer_post_walk(")
        assert hook_idx != -1

        # The nearest preceding `try:` before the hook call, within the same
        # tail block, must be followed (after the hook call) by an
        # `except Exception` that does NOT bare `raise`.
        preceding = source[:hook_idx]
        try_idx = preceding.rfind("try:")
        assert try_idx != -1, "the hook call must be wrapped in its own try block"

        following = source[hook_idx:]
        except_idx = following.find("except Exception")
        assert except_idx != -1, (
            "the hook call's try block must be closed by an except Exception "
            "clause (containment, mirrors the qa_dedup_proposer post-pass)."
        )
        except_block = following[except_idx : except_idx + 400]
        assert "raise" not in except_block.split("\n")[0:6].__str__(), (
            "the producer-chain except clause must swallow (log, not re-raise) "
            "so a producer fault cannot fail the already-landed ingest walk."
        )

    def test_app_main_imports_trigger_producer_post_walk(self) -> None:
        flow = _flow_module()
        assert hasattr(flow, "trigger_producer_post_walk")
