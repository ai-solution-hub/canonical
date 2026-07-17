"""Flow-scope meta-context for per-flow op_id + source_document_id propagation.

`stamp_extraction_base()` (extraction.py) reads the current flow's op_id +
source_document_id from `FLOW_META_CTX` without callers having to thread the
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

    `source_document_id` is None at flow start (before any row is bound) and
    rebound when stamping a specific extracted row. Frozen for immutability.
    """

    op_id: UUID
    source_document_id: UUID | None = None


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
    source_document_id: UUID | None = None,
) -> AsyncIterator[FlowRunMeta]:
    """Bind FLOW_META_CTX for the duration of the wrapped async block.

    Token-based reset on exit — safe against nesting + exceptions.
    """
    meta = FlowRunMeta(op_id=op_id, source_document_id=source_document_id)
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


# Stage-counter binding (ID-49.4 — Inv-17 embedding-stage observability).
#
# `app_main()` aggregates per-stage counts at flow scope (cocoindex 1.0.3
# exposes no per-stage completion callbacks — RESEARCH §R7), but the
# per-item `ingest_file` component runs inside `mount_each` with no direct
# access to `app_main`'s local `stage_counts` dict. This is the SAME
# constraint the retry counter solved: route a flow-scope-bound counter
# through `flow_context` so `ingest_file` can bump it without a
# `flow.py → ingest_file` argument-threading cycle. `app_main` reads the
# bound counter back at webhook-emit and folds it into `stage_counts`.
#
# Scoped to the EMBEDDING stage at v1 (Inv-17 closure for the gap inherited
# from ID-49.2 — `stage_counts['embedding']` was initialised to 0 and never
# incremented). The protocol is stage-keyed so the same substrate can carry
# additional stages (e.g. binary_conversion) if the broader observability
# gap — the test-only `_record_extraction_success` helper — is closed later
# (see the ID-49.4 journal OQ + backlog ID-158 / ID-162).


class StageCounterProtocol(Protocol):
    """Structural type any per-flow stage counter must satisfy.

    `_FlowStageCounter` in `flow.py` is the production implementation;
    tests supply lightweight stand-ins. Keys are canonical stage names
    (e.g. `"embedding"`) matching `_empty_stage_counts()`.
    """

    def increment(self, stage: str) -> None: ...
    def get(self, stage: str) -> int: ...


_stage_counter_var: contextvars.ContextVar[StageCounterProtocol | None] = (
    contextvars.ContextVar("_kh_flow_stage_counter_var", default=None)
)


@asynccontextmanager
async def bind_stage_counter(
    counter: StageCounterProtocol,
) -> AsyncIterator[StageCounterProtocol]:
    """Bind a stage counter for the duration of the wrapped async block."""
    token = _stage_counter_var.set(counter)
    try:
        yield counter
    finally:
        _stage_counter_var.reset(token)


def current_stage_counter() -> StageCounterProtocol | None:
    """Return the currently-bound stage counter, or None if no binding."""
    return _stage_counter_var.get()


# Taxonomy-miss-counter binding (ID-63.8 — Inv-7 out-of-taxonomy soft-warn).
#
# `ClassificationExtraction`'s `_surface_out_of_taxonomy_classification`
# model-validator (extraction.py) records a miss each time the LLM proposes a
# `primary_domain` / `primary_subtopic` / `secondary_classification` value
# outside the canonical taxonomy snapshot. The row is STILL written unchanged
# (soft-warn, never raise — PRODUCT Inv-7); the counter exists purely for
# observability. Routing it through `flow_context` (rather than a direct
# `extraction.py → flow.py` import) avoids an import cycle and lets unit tests
# omit the binding entirely (the validator skips `.record()` when
# `current_taxonomy_miss_counter()` is None), exactly as the retry / stage
# counters do.
#
# The counter is keyed by `(field, value)` so the flow-end webhook can break
# the tally down by field — `field` is one of `'primary_domain'`,
# `'primary_subtopic'`, `'secondary_classification'`.


class TaxonomyMissCounter(Protocol):
    """Structural type any per-flow taxonomy-miss counter must satisfy.

    `_FlowTaxonomyMissCounter` in `flow.py` is the production implementation;
    tests supply lightweight stand-ins. `field` distinguishes the dimension
    that missed (`'primary_domain'` / `'primary_subtopic'` /
    `'secondary_classification'`); `value` is the offending taxonomy term.
    """

    def record(self, *, field: str, value: str) -> None: ...
    def get(self, *, field: str, value: str) -> int: ...
    def tally_by_field(self) -> dict[str, int]: ...


_taxonomy_miss_counter_var: contextvars.ContextVar[TaxonomyMissCounter | None] = (
    contextvars.ContextVar("_kh_flow_taxonomy_miss_counter_var", default=None)
)


@asynccontextmanager
async def bind_taxonomy_miss_counter(
    counter: TaxonomyMissCounter,
) -> AsyncIterator[TaxonomyMissCounter]:
    """Bind a taxonomy-miss counter for the duration of the wrapped async block.

    Token-based reset on exit — safe against nesting + exceptions, mirroring
    `bind_retry_counter` / `bind_stage_counter`.
    """
    token = _taxonomy_miss_counter_var.set(counter)
    try:
        yield counter
    finally:
        _taxonomy_miss_counter_var.reset(token)


def current_taxonomy_miss_counter() -> TaxonomyMissCounter | None:
    """Return the currently-bound taxonomy-miss counter, or None if no binding."""
    return _taxonomy_miss_counter_var.get()


# Memo-heal-counter binding (ID-127.33 — self-healing memo, S457 ratification).
#
# `extraction.py`'s `extract_with_memo_self_heal` wrapper bumps a flow-scope
# counter each time a `@coco.fn(memo=True)` Path-A extractor's memo-HIT
# deserialize raises `cocoindex._internal.serde.DeserializationError` (a
# stale LMDB payload replayed against the current extraction schema — S456/
# S457 evidence: 3 corpus items stuck on `ClassificationExtraction`) and the
# wrapper falls back to a fresh, un-memoised extraction so the item still
# succeeds instead of failing outright. Routing it through `flow_context`
# (rather than a direct `extraction.py -> flow.py` import) mirrors the retry
# / taxonomy-miss counters exactly: same daemon-thread rebind discipline
# (ID-66.19 — `ingest_file` / `ingest_url` re-bind this ContextVar locally on
# the `_LoopRunner` worker thread), same graceful-degradation contract (the
# wrapper simply skips `.record()` when `current_memo_heal_counter()` is
# None — e.g. `ingest_once` callers that never bind one).
#
# Keyed by `extractor` (one of `'classification'` / `'qa_form'` /
# `'entity_mentions'` / `'relationships'`) so the flow-end webhook can break
# the tally down per extractor — burn observability is the explicit owner
# guardrail from the S457 ratification journal.


class MemoHealCounter(Protocol):
    """Structural type any per-flow memo-heal counter must satisfy.

    `_FlowMemoHealCounter` in `flow.py` is the production implementation;
    tests supply lightweight stand-ins.
    """

    def record(self, *, extractor: str) -> None: ...
    def get(self, *, extractor: str) -> int: ...
    def tally(self) -> dict[str, int]: ...


_memo_heal_counter_var: contextvars.ContextVar[MemoHealCounter | None] = (
    contextvars.ContextVar("_kh_flow_memo_heal_counter_var", default=None)
)


@asynccontextmanager
async def bind_memo_heal_counter(
    counter: MemoHealCounter,
) -> AsyncIterator[MemoHealCounter]:
    """Bind a memo-heal counter for the duration of the wrapped async block.

    Token-based reset on exit — safe against nesting + exceptions, mirroring
    `bind_retry_counter` / `bind_taxonomy_miss_counter`.
    """
    token = _memo_heal_counter_var.set(counter)
    try:
        yield counter
    finally:
        _memo_heal_counter_var.reset(token)


def current_memo_heal_counter() -> MemoHealCounter | None:
    """Return the currently-bound memo-heal counter, or None if no binding active."""
    return _memo_heal_counter_var.get()
