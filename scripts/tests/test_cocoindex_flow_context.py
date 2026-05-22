"""Unit tests for `scripts/cocoindex_pipeline/flow_context.py` — Subtask 28.16.

Verifies the FLOW_META_CTX context-binding substrate that backs
`stamp_extraction_base()` per Q-EX2 TECH §3.2 + ID-28.16 brief acceptance.

Covers:
- `FlowRunMeta` Pydantic dataclass shape (op_id + content_items_id).
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

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))


# ============================================================================
# FlowRunMeta dataclass — payload contract
# ============================================================================


class TestFlowRunMeta:
    """The FlowRunMeta payload carries op_id + content_items_id."""

    def test_module_exposes_flow_run_meta(self) -> None:
        from cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "FlowRunMeta")

    def test_construct_with_op_id_and_content_items_id(self) -> None:
        from cocoindex_pipeline.flow_context import FlowRunMeta

        op_id = uuid4()
        content_items_id = uuid4()
        meta = FlowRunMeta(op_id=op_id, content_items_id=content_items_id)
        assert meta.op_id == op_id
        assert meta.content_items_id == content_items_id

    def test_content_items_id_is_optional(self) -> None:
        """Flow start emits before any content_items row exists; the
        per-row stamper provides content_items_id at extractor-invocation
        time. The payload must accept None for the pre-row state."""
        from cocoindex_pipeline.flow_context import FlowRunMeta

        op_id = uuid4()
        meta = FlowRunMeta(op_id=op_id, content_items_id=None)
        assert meta.op_id == op_id
        assert meta.content_items_id is None


# ============================================================================
# FLOW_META_CTX identity handle
# ============================================================================


class TestFlowMetaCtxIdentity:
    """`FLOW_META_CTX: coco.ContextKey[FlowRunMeta]` identity per brief."""

    def test_module_exposes_flow_meta_ctx(self) -> None:
        from cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "FLOW_META_CTX")

    def test_flow_meta_ctx_is_a_coco_context_key(self) -> None:
        """Per Liam-ratified Option (a), the symbol is a `coco.ContextKey`
        for type-stable identity even though the storage uses stdlib
        contextvars (SIGNATURE_DRIFT workaround documented in journal)."""
        import cocoindex as coco

        from cocoindex_pipeline.flow_context import FLOW_META_CTX

        assert isinstance(FLOW_META_CTX, coco.ContextKey)


# ============================================================================
# bind_flow_meta() / current_flow_meta() — per-task scoping
# ============================================================================


class TestBindFlowMeta:
    """`bind_flow_meta()` is an async context manager that sets the value
    for the wrapped block; on exit the previous value is restored."""

    def test_module_exposes_bind_flow_meta(self) -> None:
        from cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "bind_flow_meta")
        assert callable(flow_context.bind_flow_meta)

    def test_module_exposes_current_flow_meta(self) -> None:
        from cocoindex_pipeline import flow_context

        assert hasattr(flow_context, "current_flow_meta")
        assert callable(flow_context.current_flow_meta)

    def test_current_returns_none_when_unbound(self) -> None:
        from cocoindex_pipeline.flow_context import current_flow_meta

        # Without a wrapping `async with bind_flow_meta(...)`, the helper
        # returns None — this is the idle-state contract.
        assert current_flow_meta() is None

    def test_bind_sets_value_inside_block(self) -> None:
        from cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id = uuid4()
        content_items_id = uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(
                op_id=op_id, content_items_id=content_items_id
            ):
                meta = current_flow_meta()
                assert meta is not None
                assert meta.op_id == op_id
                assert meta.content_items_id == content_items_id

        asyncio.run(_exercise())

    def test_bind_restores_previous_value_on_exit(self) -> None:
        from cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        async def _exercise() -> None:
            assert current_flow_meta() is None
            async with bind_flow_meta(op_id=uuid4(), content_items_id=uuid4()):
                assert current_flow_meta() is not None
            # On exit the value reverts.
            assert current_flow_meta() is None

        asyncio.run(_exercise())

    def test_bind_allows_none_content_items_id(self) -> None:
        """Flow start emits before any per-row content_items_id is known."""
        from cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id = uuid4()

        async def _exercise() -> None:
            async with bind_flow_meta(op_id=op_id, content_items_id=None):
                meta = current_flow_meta()
                assert meta is not None
                assert meta.op_id == op_id
                assert meta.content_items_id is None

        asyncio.run(_exercise())


class TestPerTaskIsolation:
    """Concurrent asyncio tasks see independent FLOW_META_CTX values."""

    def test_concurrent_tasks_see_independent_values(self) -> None:
        from cocoindex_pipeline.flow_context import (
            bind_flow_meta,
            current_flow_meta,
        )

        op_id_a = uuid4()
        op_id_b = uuid4()
        op_id_c = uuid4()

        async def _task(op_id: UUID) -> UUID | None:
            async with bind_flow_meta(op_id=op_id, content_items_id=None):
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
    explicit op_id / content_items_id are passed (28.16 contract)."""

    def test_stamp_reads_from_flow_meta_ctx(self) -> None:
        """When `stamp_extraction_base()` is called WITHOUT explicit
        op_id / content_items_id, it falls back to reading from
        `current_flow_meta()`. This is the 28.16 flow-scope wiring
        primitive — extractor outputs are stamped at flow-scope without
        the call-site needing to plumb op_id through `.transform()` chains.
        """
        from datetime import datetime, timezone
        from uuid import UUID

        from cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )
        from cocoindex_pipeline.flow_context import bind_flow_meta

        run_op_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        row_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")

        # Build a placeholder extraction with throwaway base fields — these
        # will be replaced by the stamping operation.
        original = ClassificationExtraction(
            op_id=UUID("00000000-0000-4000-8000-000000000000"),
            content_items_id=UUID("00000000-0000-4000-8000-000000000000"),
            extracted_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        async def _exercise() -> ClassificationExtraction:
            async with bind_flow_meta(
                op_id=run_op_id, content_items_id=row_id
            ):
                # Call WITHOUT explicit op_id / content_items_id — the
                # helper reads from FLOW_META_CTX.
                stamped = stamp_extraction_base(original)
                return stamped  # type: ignore[return-value]

        stamped = asyncio.run(_exercise())
        assert stamped.op_id == run_op_id
        assert stamped.content_items_id == row_id

    def test_explicit_args_override_flow_meta_ctx(self) -> None:
        """Explicit op_id / content_items_id kwargs override the
        FLOW_META_CTX-bound values — call-site-provided values win.

        This preserves the pre-28.16 explicit-stamping call signature so
        existing tests (28.12 WP3) keep passing.
        """
        from datetime import datetime, timezone
        from uuid import UUID

        from cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )
        from cocoindex_pipeline.flow_context import bind_flow_meta

        ctx_op_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
        ctx_row_id = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        explicit_op_id = UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
        explicit_row_id = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")

        original = ClassificationExtraction(
            op_id=UUID("00000000-0000-4000-8000-000000000000"),
            content_items_id=UUID("00000000-0000-4000-8000-000000000000"),
            extracted_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        async def _exercise() -> ClassificationExtraction:
            async with bind_flow_meta(
                op_id=ctx_op_id, content_items_id=ctx_row_id
            ):
                stamped = stamp_extraction_base(
                    original,
                    op_id=explicit_op_id,
                    content_items_id=explicit_row_id,
                )
                return stamped  # type: ignore[return-value]

        stamped = asyncio.run(_exercise())
        assert stamped.op_id == explicit_op_id
        assert stamped.content_items_id == explicit_row_id

    def test_stamp_raises_when_no_args_and_no_context(self) -> None:
        """When no explicit op_id / content_items_id are passed AND no
        FLOW_META_CTX is bound, the helper raises rather than silently
        stamping zero UUIDs. This protects against the "forgot to bind"
        operator error from landing zeroed rows in Postgres."""
        from datetime import datetime, timezone
        from uuid import UUID

        from cocoindex_pipeline.extraction import (
            ClassificationExtraction,
            stamp_extraction_base,
        )

        original = ClassificationExtraction(
            op_id=UUID("00000000-0000-4000-8000-000000000000"),
            content_items_id=UUID("00000000-0000-4000-8000-000000000000"),
            extracted_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
            content_type="research",
            primary_domain="security",
            classification_confidence=0.9,
        )

        with pytest.raises(RuntimeError) as exc_info:
            stamp_extraction_base(original)

        # Surface useful operator guidance — name FLOW_META_CTX so the
        # error message tells operators exactly which binding to apply.
        assert "FLOW_META_CTX" in str(exc_info.value)
