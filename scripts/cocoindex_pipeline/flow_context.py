"""Flow-scope meta-context for per-flow op_id + content_items_id propagation.

Per Subtask ID-28.16 (Liam-ratified Option (a), S257 W2b): the cocoindex
1.0.3 LLM-extraction stage emits extracted rows from `@coco.fn(memo=True)`
extractors via `.transform()` chains. Each emitted row must carry the
flow's `op_id` (Inv-11/12) and the source `content_items_id` (per-row PK)
on the `_ExtractionBase` fields before any downstream Postgres write.

The brief asks for `FLOW_META_CTX: coco.ContextKey[FlowRunMeta]` bound
at `app_main()` such that `stamp_extraction_base()` can read the current
flow's metadata without the call-site needing to thread op_id/content_items_id
through every `.transform()` argument.

Empirical re-check (Q-EX2 / OQ-3) recorded for the Checker:
  - `cocoindex 1.0.3`
  - `cocoindex.use_context(key)` PRESENT — single-arg, **read-only**:
    signature is `use_context(key: ContextKey[T]) -> T`. **SIGNATURE_DRIFT**
    from the S257 W1 documentation, which described a 2-arg form
    `use_context(key, value)`. The 2-arg form does NOT exist in 1.0.3 —
    write happens via `ContextProvider.provide(key, value)` invoked from
    inside a `@coco.lifespan`-registered function, which scopes the
    binding to the environment lifetime (NOT per-flow-run).
  - `cocoindex.ContextKey` PRESENT — constructor `ContextKey(key_str)`.
  - `cocoindex.lifespan` PRESENT — decorator for registering lifespan fns.
  - `cocoindex.get_component_context()` PRESENT — raises outside an
    active component context.
  - `flow["op_id"]` subscript ABSENT (unchanged from S256 WP4).

Architectural decision (Executor judgement per brief):
  - `FLOW_META_CTX` is declared as `coco.ContextKey[FlowRunMeta]` to
    preserve the brief's named identity handle and document intent.
  - Per-asyncio-task storage uses stdlib `contextvars.ContextVar`. The
    cocoindex 1.0.3 API does not expose a per-flow-run context-binding
    mechanism (only per-environment lifespan); a stdlib ContextVar is
    the canonical Python primitive for per-task value isolation and
    handles concurrent `app_main()` invocations safely.
  - `bind_flow_meta()` is an `async with` context manager that sets the
    ContextVar for the wrapped block and restores the prior value on
    exit (token-based — robust against nested calls and exceptions).
  - `current_flow_meta()` reads the current value or returns `None`.

This decision is recorded in the 28.16 journal block at completion time.

Reference: docs/reference/task-list.json → ID-28 → Subtask 16
"""

from __future__ import annotations

import contextvars
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator
from uuid import UUID

import cocoindex as coco


# ---------------------------------------------------------------------------
# Payload contract — FlowRunMeta
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FlowRunMeta:
    """Per-flow metadata propagated to extraction post-processing.

    Carries:
      - `op_id`: cocoindex per-flow op_id (UUID v4 — generated in
        `app_main()` until cocoindex exposes `flow["op_id"]`).
      - `content_items_id`: per-row primary key of the `content_items`
        row whose `content_text` is the extraction input. Defaults to
        None for the flow-start window where rows are not yet bound.

    Frozen for immutability — `FLOW_META_CTX` is rebound on every
    `app_main()` invocation rather than mutating an in-place payload.
    """

    op_id: UUID
    content_items_id: UUID | None = None


# ---------------------------------------------------------------------------
# FLOW_META_CTX identity handle — Liam-ratified Option (a) name
# ---------------------------------------------------------------------------
#
# Per the brief, we expose the symbol as a `coco.ContextKey[FlowRunMeta]`
# so callers see a type-stable identity handle. The actual storage is
# stdlib contextvars (see module docstring SIGNATURE_DRIFT note) — the
# `ContextKey` is identity-only at this layer.

def _build_flow_meta_ctx() -> coco.ContextKey[FlowRunMeta]:
    """Build (or reuse) the FLOW_META_CTX ContextKey defensively.

    `cocoindex.ContextKey` enforces process-global uniqueness on the key
    string via a module-level `_used_keys` set. If `flow_context.py` is
    imported under two different package paths in one Python process
    (e.g. `scripts.cocoindex_pipeline.flow_context` AND
    `cocoindex_pipeline.flow_context` via `sys.path.insert`), the second
    import would trip the uniqueness check.

    This builder catches the `ValueError("Context key X already used")`
    raised by the registry on the second call and reuses the prior key —
    the underlying storage is stdlib `contextvars.ContextVar` (module-
    global on its own merits), so two ContextKey instances naming the
    same string would point at the same backing storage anyway.

    A bare `coco.ContextKey("kh_pipeline_flow_meta")` would also work in
    production (where `flow_context` is imported exactly once), but the
    defensive guard makes the symbol robust against test-runner sys.path
    permutations and any future repeated-import scenarios.
    """
    key_str = "kh_pipeline_flow_meta"
    try:
        return coco.ContextKey(key_str)
    except ValueError:
        # The key was already registered on a prior import — return a
        # ContextKey instance with the same string identity. Cocoindex's
        # registry uses key._key as the lookup; the new instance and the
        # prior instance both compare equal under that semantic. We use
        # __new__ to bypass the registry-tripping __init__ and set
        # _key/_detect_change manually.
        ck = coco.ContextKey.__new__(coco.ContextKey)
        ck._key = key_str  # type: ignore[attr-defined]
        ck._detect_change = False  # type: ignore[attr-defined]
        return ck


FLOW_META_CTX: coco.ContextKey[FlowRunMeta] = _build_flow_meta_ctx()


# Stdlib ContextVar backing — module-private. Per-asyncio-task scoping.
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

    On exit (normal or exceptional), the prior value is restored via
    contextvar token reset — safe against nested calls and exception
    paths.

    Usage from `app_main()`:

        async with bind_flow_meta(
            op_id=run_op_id, content_items_id=None
        ) as meta:
            # extractor invocations inside this block see `meta` via
            # `current_flow_meta()` — stamp_extraction_base() picks it up.
            ...

    Args:
      op_id:            The flow's op_id (UUID v4).
      content_items_id: Per-row PK — None at flow-start before any rows
                        are bound; populated when stamping a specific
                        extracted row (typically via a fresh
                        `bind_flow_meta(...)` wrapping the per-row
                        extractor call).

    Yields:
      The freshly-bound `FlowRunMeta` so callers may inspect it.
    """
    meta = FlowRunMeta(op_id=op_id, content_items_id=content_items_id)
    token = _flow_meta_var.set(meta)
    try:
        yield meta
    finally:
        _flow_meta_var.reset(token)


def current_flow_meta() -> FlowRunMeta | None:
    """Return the currently-bound FlowRunMeta, or None if no binding active.

    `stamp_extraction_base()` calls this when no explicit op_id /
    content_items_id are passed, so the extraction-post-processing layer
    can pick up the flow-scope metadata without the call-site needing to
    plumb it through `.transform()` chains.
    """
    return _flow_meta_var.get()
