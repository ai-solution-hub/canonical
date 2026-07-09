"""Unit tests for `scripts/cocoindex_pipeline/flow_context.py` — Subtask 28.16.

Verifies the FLOW_META_CTX context-binding substrate that backs
`stamp_extraction_base()` per Q-EX2 TECH §3.2 + ID-28.16 brief acceptance.

Covers:
- `FlowRunMeta` Pydantic dataclass shape (op_id + source_document_id).
- `FLOW_META_CTX: coco.ContextKey[FlowRunMeta]` symbol identity preserved
  per the brief's Liam-ratified Option (a) name.
- `bind_flow_meta()` async context manager binds + restores per-task.
- `current_flow_meta()` reads the currently-bound FlowRunMeta or returns
  None when unbound.
- Per-task isolation: concurrent asyncio tasks see independent values
  (this is the crux of the cocoindex 1.0.3 signature-drift workaround —
  cocoindex's `use_context(key)` is read-only single-arg, so we use a
  stdlib `contextvars.ContextVar` for per-task storage while preserving
  the `coco.ContextKey` identity handle per the brief).

Empirical-grounding (Q-EX2 / OQ-3) recorded in 28.16 journal:
- `cocoindex.use_context(key)` PRESENT — single-arg read-only.
- `cocoindex.use_context(key, value)` ABSENT — SIGNATURE_DRIFT from the
  S257 W1 documentation; the 2-arg form does NOT exist in 1.0.3.
- `cocoindex.ContextKey` PRESENT — used here for identity-level handle.
- `EnvironmentBuilder.provide(key, value)` is the lifespan-time write
  mechanism (environment-scoped, not per-flow-run).
- Per-flow-run scoping in 1.0.3 requires either a mutable container
  bound at lifespan OR a stdlib `contextvars.ContextVar`. KH picks the
  latter as more idiomatic for per-asyncio-task isolation.

Reference: docs/reference/task-list.json → ID-28 → Subtask 16
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from uuid import UUID, uuid4

import pytest

# ── Path setup ──────────────────────────────────────────────────────────────
# sys.path.insert(0, _SCRIPTS_DIR) was removed (ID-67.2): pyproject.toml
# pythonpath = ["scripts"] makes the bare path insert redundant.


# ============================================================================
# FlowRunMeta dataclass — payload contract
# ============================================================================


class TestFlowRunMeta:
    """The FlowRunMeta payload carries op_id + source_document_id."""

    def test_module_exposes_flow_run_meta(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "FlowRunMeta")

    def test_construct_with_op_id_and_source_document_id(self) -> None:
        from scripts.cocoindex_pipeline.flow_context import FlowRunMeta

        op_id = uuid4()
        source_document_id = uuid4()
        meta = FlowRunMeta(op_id=op_id, source_document_id=source_document_id)
        assert meta.op_id == op_id
        assert meta.source_document_id == source_document_id

    def test_source_document_id_is_optional(self) -> None:
        """Flow start emits before any per-document row exists (a
        source_documents row, since {127.25} DR-034 — content_items is
        dropped both envs and never the target here); the per-row stamper
        provides source_document_id at extractor-invocation time. The
        payload must accept None for the pre-row state."""
        from scripts.cocoindex_pipeline.flow_context import FlowRunMeta

        op_id = uuid4()
        meta = FlowRunMeta(op_id=op_id, source_document_id=None)
        assert meta.op_id == op_id
        assert meta.source_document_id is None


# ============================================================================
# FLOW_META_CTX identity handle
# ============================================================================


class TestFlowMetaCtxIdentity:
    """`FLOW_META_CTX: coco.ContextKey[FlowRunMeta]` identity per brief."""

    def test_module_exposes_flow_meta_ctx(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "FLOW_META_CTX")

    def test_flow_meta_ctx_is_a_coco_context_key(self) -> None:
        """Per Liam-ratified Option (a), the symbol carries `coco.ContextKey`
        identity (string key) even though the backing storage uses stdlib
        contextvars (SIGNATURE_DRIFT workaround documented in
        flow_context.py module docstring).

        Sibling tests in this suite stub
        `sys.modules["cocoindex"] = MagicMock(...)` for LMDB-free
        isolation, which causes `coco.ContextKey(key)` to return another
        MagicMock with attribute-access returning yet more MagicMocks.
        Under that condition, `FLOW_META_CTX.key` is not a real string —
        we skip the string-equality assertion. Under REAL cocoindex
        (production + this test file in isolation), the assertion is
        meaningful and ensures the brief-named symbol carries the right
        identity. Same robustness pattern as
        `test_extract_classification_call_returns_awaitable` in
        test_cocoindex_extractors.py.
        """
        from unittest.mock import MagicMock

        import cocoindex as coco

        from scripts.cocoindex_pipeline.flow_context import FLOW_META_CTX

        assert hasattr(FLOW_META_CTX, "key"), (
            "FLOW_META_CTX must expose a `key` attribute (coco.ContextKey "
            "identity contract)"
        )

        # If the FLOW_META_CTX was built under a stubbed cocoindex (e.g.
        # because a sibling flow-family test in the same pytest process
        # loaded flow_context.py via `fresh_flow_module()` before us —
        # the canonical `scripts.cocoindex_pipeline.*` namespace is now
        # shared, so stub-loaded modules stay resident), skip the strict
        # string-key assertion. We still assert the symbol is non-None and
        # the `key` attribute exists, which is the part of the contract we
        # can verify under any cocoindex residency (ID-67 canonicalisation).
        if isinstance(coco, MagicMock) or isinstance(FLOW_META_CTX, MagicMock):
            # Stubbed cocoindex (process or module-level) — behavioural only.
            assert FLOW_META_CTX is not None
            return

        # Real cocoindex — strict identity check.
        assert isinstance(FLOW_META_CTX.key, str), (
            "FLOW_META_CTX.key must be a string (coco.ContextKey contract)"
        )
        assert FLOW_META_CTX.key == "kh_pipeline_flow_meta"


# ============================================================================
# bind_flow_meta() / current_flow_meta() — per-task scoping
# ============================================================================


class TestBindFlowMeta:
    """`bind_flow_meta()` is an async context manager that sets the value
    for the wrapped block; on exit the previous value is restored."""

    def test_module_exposes_bind_flow_meta(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "bind_flow_meta")
        assert callable(flow_context.bind_flow_meta)

    def test_module_exposes_current_flow_meta(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "current_flow_meta")
        assert callable(flow_context.current_flow_meta)

    def test_current_returns_none_when_unbound(self) -> None:
        from scripts.cocoindex_pipeline.flow_context import current_flow_meta

        # Without a wrapping `async with bind_flow_meta(...)`, the helper
        # returns None — this is the idle-state contract.
        assert current_flow_meta() is None

    def test_bind_sets_value_inside_block(self) -> None:
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id = uuid4()
        source_document_id = uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(
                op_id=op_id, source_document_id=source_document_id
            ):
                meta = current_flow_meta()
                assert meta is not None
                assert meta.op_id == op_id
                assert meta.source_document_id == source_document_id

        asyncio.run(_exercise())

    def test_bind_restores_previous_value_on_exit(self) -> None:
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        async def _exercise() -> None:
            assert current_flow_meta() is None
            async with bind_flow_meta(op_id=uuid4(), source_document_id=uuid4()):
                assert current_flow_meta() is not None
            # On exit the value reverts.
            assert current_flow_meta() is None

        asyncio.run(_exercise())

    def test_bind_allows_none_source_document_id(self) -> None:
        """Flow start emits before any per-row source_document_id is known."""
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id = uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=op_id, source_document_id=None):
                meta = current_flow_meta()
                assert meta is not None
                assert meta.op_id == op_id
                assert meta.source_document_id is None

        asyncio.run(_exercise())


class TestPerTaskIsolation:
    """Concurrent asyncio tasks see independent FLOW_META_CTX values."""

    def test_concurrent_tasks_see_independent_values(self) -> None:
        from scripts.cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id_a = uuid4()
        op_id_b = uuid4()
        op_id_c = uuid4()

        async def _task(op_id: UUID) -> UUID | None:
            async with bind_flow_meta(op_id=op_id, source_document_id=None):
                await asyncio.sleep(0.001)
                meta = current_flow_meta()
                return meta.op_id if meta else None

        async def _exercise() -> list[UUID | None]:
            return await asyncio.gather(
                _task(op_id_a), _task(op_id_b), _task(op_id_c)
            )

        results = asyncio.run(_exercise())
        assert results == [op_id_a, op_id_b, op_id_c]


class TestStampWithFlowMeta:
    """`stamp_extraction_base()` can read from FLOW_META_CTX when no
    explicit op_id / source_document_id are passed (28.16 contract)."""

    def test_stamp_reads_from_flow_meta_ctx(self) -> None:
        """When `stamp_extraction_base()` is called WITHOUT explicit
        op_id / source_document_id, it falls back to reading from
        `current_flow_meta()`. This is the 28.16 flow-scope wiring
        primitive — extractor outputs are stamped at flow-scope without
        the call-site needing to plumb op_id through `.transform()` chains.
        """
        from uuid import UUID

        from scripts.cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        run_op_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        row_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

        # Build a placeholder extraction with throwaway base fields — these
        # will be replaced by the stamping operation.
        # bl-220 / ID-74: ClassificationExtraction is the stamp-free core (no
        # op_id / source_document_id / extracted_at); stamp_extraction_base
        # CONSTRUCTS the stamped type from it + the resolved values.
        original = ClassificationExtraction(
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        async def _exercise() -> ClassificationExtraction:
            async with bind_flow_meta(
                op_id=run_op_id, source_document_id=row_id
            ):
                # Call WITHOUT explicit op_id / source_document_id — the
                # helper reads from FLOW_META_CTX.
                stamped = stamp_extraction_base(original)
                return stamped  # type: ignore[return-value]

        stamped = asyncio.run(_exercise())
        assert stamped.op_id == run_op_id
        assert stamped.source_document_id == row_id

    def test_explicit_args_override_flow_meta_ctx(self) -> None:
        """Explicit op_id / source_document_id kwargs override the
        FLOW_META_CTX-bound values — call-site-provided values win.

        This preserves the pre-28.16 explicit-stamping call signature so
        existing tests (28.12 WP3) keep passing.
        """
        from uuid import UUID

        from scripts.cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )
        from scripts.cocoindex_pipeline.flow_context import bind_flow_meta

        ctx_op_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        ctx_row_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        explicit_op_id = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
        explicit_row_id = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")

        # bl-220 / ID-74: ClassificationExtraction is the stamp-free core (no
        # op_id / source_document_id / extracted_at); stamp_extraction_base
        # CONSTRUCTS the stamped type from it + the resolved values.
        original = ClassificationExtraction(
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        async def _exercise() -> ClassificationExtraction:
            async with bind_flow_meta(
                op_id=ctx_op_id, source_document_id=ctx_row_id
            ):
                stamped = stamp_extraction_base(
                    original,
                    op_id=explicit_op_id,
                    source_document_id=explicit_row_id,
                )
                return stamped  # type: ignore[return-value]

        stamped = asyncio.run(_exercise())
        assert stamped.op_id == explicit_op_id
        assert stamped.source_document_id == explicit_row_id

    def test_stamp_raises_when_no_args_and_no_context(self) -> None:
        """When no explicit op_id / source_document_id are passed AND no
        FLOW_META_CTX is bound, the helper raises rather than silently
        stamping zero UUIDs. This protects against the "forgot to bind"
        operator error from landing zeroed rows in Postgres."""
        from uuid import UUID

        from scripts.cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )

        # bl-220 / ID-74: ClassificationExtraction is the stamp-free core (no
        # op_id / source_document_id / extracted_at); stamp_extraction_base
        # CONSTRUCTS the stamped type from it + the resolved values.
        original = ClassificationExtraction(
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        with pytest.raises(RuntimeError) as exc_info:
            stamp_extraction_base(original)

        # Surface useful operator guidance — name FLOW_META_CTX so the
        # error message tells operators exactly which binding to apply.
        assert "FLOW_META_CTX" in str(exc_info.value)


# ============================================================================
# Retry-counter binding — ID-28.17 substrate
# ============================================================================
#
# Per ID-28.17: the Anthropic 503-retry wrapper in extraction.py needs to call
# `_FlowRetryCounter.increment()` on each retry attempt. The counter instance
# is constructed per-flow at `app_main()` (flow.py); the wrapper reads it via
# a sibling helper added here so extraction.py does NOT need to import the
# private `_FlowRetryCounter` from flow.py (which would create a cycle and
# also cross 28.13's file-ownership boundary).
#
# Design intent: the counter binding is a SEPARATE context-var from the
# `FLOW_META_CTX` (which carries op_id + source_document_id only). Keeping them
# separate preserves the immutability of the `FlowRunMeta` dataclass and
# avoids coupling flow_context.py to flow.py's _FlowRetryCounter class.


class TestBindRetryCounter:
    """`bind_retry_counter()` exposes a counter to the wrapped block."""

    def test_module_exposes_bind_retry_counter(self) -> None:
        from scripts.cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "bind_retry_counter")
        assert hasattr(flow_context, "current_retry_counter")

    def test_unbound_default_is_none(self) -> None:
        """Outside any `bind_retry_counter()` block, `current_retry_counter()`
        returns None — the wrapper must gracefully skip `.increment()` when
        no production caller has bound a counter (e.g. extractor unit tests
        that exercise the SDK path without flow-scope wiring)."""
        from scripts.cocoindex_pipeline.flow_context import current_retry_counter

        assert current_retry_counter() is None

    def test_binding_exposes_counter_to_wrapped_block(self) -> None:
        """Inside the `async with bind_retry_counter(c)` block,
        `current_retry_counter()` returns the same counter instance."""
        from scripts.cocoindex_pipeline.flow_context import (
            bind_retry_counter,
            current_retry_counter,
        )

        class _DummyCounter:
            def __init__(self) -> None:
                self._n = 0

            def increment(self) -> None:
                self._n += 1

            def get(self) -> int:
                return self._n

        counter = _DummyCounter()

        async def _exercise() -> object | None:
            async with bind_retry_counter(counter):
                return current_retry_counter()

        result = asyncio.run(_exercise())
        assert result is counter

    def test_binding_restored_on_exit(self) -> None:
        """The async-context-manager restores the prior binding on exit."""
        from scripts.cocoindex_pipeline.flow_context import (
            bind_retry_counter,
            current_retry_counter,
        )

        class _DummyCounter:
            def increment(self) -> None: ...
            def get(self) -> int: return 0

        counter = _DummyCounter()

        async def _exercise() -> tuple[object | None, object | None]:
            async with bind_retry_counter(counter):
                inside = current_retry_counter()
            outside = current_retry_counter()
            return (inside, outside)

        inside, outside = asyncio.run(_exercise())
        assert inside is counter
        assert outside is None

    def test_concurrent_tasks_see_independent_counters(self) -> None:
        """Per-asyncio-task isolation: concurrent flows must see independent
        retry counters even though they share the same module-level
        ContextVar storage."""
        from scripts.cocoindex_pipeline.flow_context import (
            bind_retry_counter,
            current_retry_counter,
        )

        class _DummyCounter:
            def __init__(self, label: str) -> None:
                self.label = label

            def increment(self) -> None: ...
            def get(self) -> int: return 0

        ca = _DummyCounter("A")
        cb = _DummyCounter("B")

        async def _task(counter: _DummyCounter) -> str | None:
            async with bind_retry_counter(counter):
                await asyncio.sleep(0.001)
                bound = current_retry_counter()
                return bound.label if bound is not None else None  # type: ignore[attr-defined]

        async def _exercise() -> list[str | None]:
            return await asyncio.gather(_task(ca), _task(cb))

        results = asyncio.run(_exercise())
        assert results == ["A", "B"]
