"""Flow-scope meta-context for per-flow op_id + content_items_id propagation.

`stamp_extraction_base()` (extraction.py) reads the current flow's op_id +
content_items_id from `FLOW_META_CTX` without callers having to thread the
metadata through every `.transform()` chain argument.

cocoindex 1.0.3 reality check (SIGNATURE_DRIFT from spec sketch):
  - `coco.use_context(key)` is single-arg READ-ONLY; the 2-arg write form
    (used in some docs) does not exist. Per-environment writes happen via
    `ContextProvider.provide(...)` inside a `@coco.lifespan` fn — but that
    scopes to environment lifetime, NOT per-flow-run.
  - `flow["op_id"]` subscript is ABSENT.

Workaround: `FLOW_META_CTX` is declared as `coco.ContextKey[FlowRunMeta]`
as an identity handle only; per-asyncio-task storage uses stdlib
`contextvars.ContextVar`. `bind_flow_meta()` is a token-based async-CM that
sets/restores the value safely against nesting + exceptions.
"""

from __future__ import annotations

import contextvars
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator, Protocol
from uuid import UUID

import cocoindex as coco


# ---------------------------------------------------------------------------
# Payload contract — FlowRunMeta
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FlowRunMeta:
    """Per-flow metadata propagated to extraction post-processing.

    `content_items_id` is None at flow start (before any row is bound) and
    rebound when stamping a specific extracted row. Frozen for immutability.
    """

    op_id: UUID
    content_items_id: UUID | None = None


def _build_flow_meta_ctx() -> coco.ContextKey[FlowRunMeta]:
    """Build (or reuse) the FLOW_META_CTX ContextKey defensively.

    `cocoindex.ContextKey` enforces process-global uniqueness on the key
    string. If `flow_context.py` is imported under two package paths in one
    process (e.g. `scripts.cocoindex_pipeline.flow_context` AND
    `cocoindex_pipeline.flow_context` via `sys.path.insert`), the second
    `ContextKey(...)` call trips the registry. We catch the resulting
    `ValueError` and rebuild an identity-equivalent instance via `__new__`
    so both sys.modules entries see the same logical handle. (Backing
    storage is the module-level stdlib `ContextVar` below.)
    """
    key_str = "kh_pipeline_flow_meta"
    try:
        return coco.ContextKey(key_str)
    except ValueError:
        ck = coco.ContextKey.__new__(coco.ContextKey)
        ck._key = key_str  # type: ignore[attr-defined]
        ck._detect_change = False  # type: ignore[attr-defined]
        return ck


FLOW_META_CTX: coco.ContextKey[FlowRunMeta] = _build_flow_meta_ctx()


# Stdlib ContextVar backing — module-private, per-asyncio-task scoping.
_flow_meta_var: contextvars.ContextVar[FlowRunMeta | None] = (
    contextvars.ContextVar("_kh_flow_meta_var", default=None)
)


# ---------------------------------------------------------------------------
# bind_flow_meta / current_flow_meta — public surface
# ---------------------------------------------------------------------------


@asynccontextmanager
async def bind_flow_meta(
    *,
    op_id: UUID,
    content_items_id: UUID | None = None,
) -> AsyncIterator[FlowRunMeta]:
    """Bind FLOW_META_CTX for the duration of the wrapped async block.

    Token-based reset on exit — safe against nesting + exceptions.
    """
    meta = FlowRunMeta(op_id=op_id, content_items_id=content_items_id)
    token = _flow_meta_var.set(meta)
    try:
        yield meta
    finally:
        _flow_meta_var.reset(token)


def current_flow_meta() -> FlowRunMeta | None:
    """Return the currently-bound FlowRunMeta, or None if no binding active."""
    return _flow_meta_var.get()


# Retry-counter binding (ID-28.17 substrate).
#
# The Anthropic 503-retry wrapper in `extraction.py` bumps a flow-scope
# counter on each retry. Routing it through `flow_context` (rather than
# direct import) avoids a `flow.py → extraction.py` cycle, keeps
# `FlowRunMeta` immutable (no mutable counter field), and lets unit tests
# omit the binding entirely (the wrapper skips `.increment()` when
# `current_retry_counter()` is None).


class RetryCounterProtocol(Protocol):
    """Structural type any per-flow retry counter must satisfy.

    `_FlowRetryCounter` in `flow.py` is the production implementation;
    tests supply lightweight stand-ins.
    """

    def increment(self) -> None: ...
    def get(self) -> int: ...


_retry_counter_var: contextvars.ContextVar[RetryCounterProtocol | None] = (
    contextvars.ContextVar("_kh_flow_retry_counter_var", default=None)
)


@asynccontextmanager
async def bind_retry_counter(
    counter: RetryCounterProtocol,
) -> AsyncIterator[RetryCounterProtocol]:
    """Bind a retry counter for the duration of the wrapped async block."""
    token = _retry_counter_var.set(counter)
    try:
        yield counter
    finally:
        _retry_counter_var.reset(token)


def current_retry_counter() -> RetryCounterProtocol | None:
    """Return the currently-bound retry counter, or None if no binding."""
    return _retry_counter_var.get()
