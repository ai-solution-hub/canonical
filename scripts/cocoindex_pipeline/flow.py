"""Cocoindex 1.0.3 canonical 6-stage pipeline (T8).

Stages (flow-scope):
  1. source walk            -> connectors.localfs.walk_dir(live=True, recursive=True)
  2. binary conversion      -> per-MIME adapters (P-3): docling for PDF/DOCX/XLSX,
                               pullmd HTTP client for HTML, passthrough for markdown
  3. LLM extraction         -> Path A: @coco.fn(memo=True) extractors call anthropic
                               SDK + Pydantic TypeAdapter validation
  4. embedding              -> LiteLLMEmbedder("text-embedding-3-large",
                               dimensions=1024) → vector(1024) (ID-49.2)
  5. entity resolution      -> TODO entity_resolution stub
  6. Postgres UPSERT        -> postgres.mount_table_target(managed_by=ManagedBy.USER)
                               for content_items, q_a_extractions, source_documents

Source-binding folder: env var COCOINDEX_SOURCE_PATH (T8 ships EMPTY default;
T7 stages files post-T8 stable per O-Q8).

Retry policy (P-OQ2): cocoindex defaults — 3 retries, exponential backoff,
1 s base. KH does not override at v1; the only KH-owned retry surface is the
Anthropic SDK call inside the @coco.fn extractors (`_anthropic_retry` in
extraction.py — Inv-23 transient-503 wrapper).

CLAUDE.md gotchas applied:
  - localfs.walk_dir(recursive=True)  (default is False)
  - cocoindex requires dangerouslyDisableSandbox in dev
  - content_items.content_text_hash is GENERATED ALWAYS — omit from TableSchema

cocoindex 1.0.3 API deviations (load-bearing for callers — DO NOT "fix"):
  - `coco.AppConfig` has NO `main_fn` field; use `coco.App(AppConfig(...), main_fn)`.
  - `@coco.fn` decorator has NO `retries` / `backoff_base_ms` kwargs.
  - `mount_table_target` exposes NO per-row UPSERT completion callback; the v1
    `_emit_upsert_log()` substrate documents the contract; real invocation waits
    on a public callback surface (TECH.md §P-5 amendment queue).
  - No public retry primitive on the postgres connector or @coco.fn extractors;
    KH-authored retry wrappers (see `_FlowRetryCounter`, `_anthropic_retry` in
    extraction.py) own the surface.

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2, §P-5, §P-7, §P-8
  docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-23..Inv-27
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Literal

import aiohttp
import asyncpg
import cocoindex as coco
from cocoindex.connectors import localfs
from cocoindex.connectors.postgres import (
    ColumnDef,
    TableSchema,
    mount_table_target,
)
from cocoindex.connectorkits.target import ManagedBy

from scripts.cocoindex_pipeline.adapters import (
    convert_binary_to_markdown,  # P-3 outer-tier adapter (28.7 — LANDED)
)

# ── Stage 3 imports — Path A canonical (S256 W1 / WP4) ─────────────────────
# Path A: KH-authored @coco.fn(memo=True) extractors call anthropic SDK
# directly + validate via Pydantic TypeAdapter. NO ExtractByLlm / LlmSpec /
# LlmApiType (those symbols are ABSENT in cocoindex 1.0.3 per OQ-3 empirical
# verification — see docs/research/cocoindex-1.0.3-extractbyllm-spec-reality-
# investigation.md). Co-located in extraction.py to avoid circular imports +
# keep extraction concerns in one module (architectural choice ratified in
# Subtask 28.12 journal).
#
# Stage 4 (embedding) LANDED in ID-49.2 — see `embed_content_text` +
# `LiteLLMEmbedder` import below. Stage 5 (entity_resolution) is still OUT OF
# SCOPE here (lands in ID-49.5, needs faiss-cpu); its placeholder block is
# preserved at the Stage-5 marker below.
from scripts.cocoindex_pipeline.extraction import (
    extract_classification,
    extract_entity_mentions,
    extract_qa_form,
    stamp_extraction_base,
)

# Production LLM model tier per cocoindex-extraction-contract TECH §3.1.
# Single source of truth lives in extraction.py (ID-44.3 dedup); re-exported
# here so `flow.ANTHROPIC_MODEL` resolves for the idle-mode test pin and any
# flow-scope consumer. Not referenced in flow.py's body — hence the F401
# suppression (matches the re-export convention in __main__.py / server.py).
#
# RELATIVE import is load-bearing: `scripts` is on sys.path under pytest
# (pyproject pythonpath), so the same physical extraction.py lands in
# sys.modules under BOTH `cocoindex_pipeline.extraction` AND
# `scripts.cocoindex_pipeline.extraction`, each with its own module-level
# objects (the hyphenated "claude-opus-4-6" literal is not interned, so the
# two copies are NOT identical). A `.extraction` relative import resolves
# through flow.__package__ — i.e. whichever namespace flow itself was imported
# under — keeping `flow.ANTHROPIC_MODEL is extraction.ANTHROPIC_MODEL` true for
# any single-namespace caller. This mirrors the `importlib.import_module(
# f"{__package__}.flow_context")` lazy-import rationale in extraction.py.
from .extraction import ANTHROPIC_MODEL  # noqa: F401 — re-export, single source of truth
from scripts.cocoindex_pipeline.flow_context import (
    FLOW_META_CTX,  # noqa: F401 — re-exported flow-context surface (28.13 wiring + tests)
    bind_flow_meta,
    bind_retry_counter,
    bind_stage_counter,
    current_flow_meta,  # noqa: F401 — re-export; ingest_file resolves it via __package__
)
# ────────────────────────────────────────────────────────────────────────────

_logger = logging.getLogger(__name__)


# ── Inv-13 v1 substrate helper (P-5) ─────────────────────────────────────────


def _emit_upsert_log(
    *,
    op_id: uuid.UUID | str,
    table: str,
    row_id: uuid.UUID | str,
    operation: Literal["INSERT", "UPDATE"],
) -> None:
    """Emit one Cloud-Run-parseable structured log per Postgres UPSERT.

    Inv-13 audit-observability substrate (Cloud Run picks up JSON log
    lines into `jsonPayload` automatically). Contract shape:

      {"event": "cocoindex.upsert", "op_id": "<uuid>", "table": "<name>",
       "row_id": "<uuid>", "operation": "INSERT" | "UPDATE"}

    Real per-row invocation waits on a cocoindex 1.0.x per-UPSERT
    completion callback (TECH.md §P-5 amendment queue). Until then this
    helper's contract — shape + level + logger — is the v1 substrate.
    """
    _logger.info(
        json.dumps(
            {
                "event": "cocoindex.upsert",
                "op_id": str(op_id),
                "table": table,
                "row_id": str(row_id),
                "operation": operation,
            }
        )
    )


# ── Inv-25 stage-level error classification (P-8 — ID-28.13) ─────────────────


# Canonical 6-class stage-level error vocabulary per PRODUCT Inv-25.
# Mirror of `lib/pipeline/error-classes.ts::PIPELINE_ERROR_CLASSES`.
# Source-of-truth lives in the TS module (consumed by the Vercel route's
# Zod validator); this Python tuple is the emitter-side reflection. The
# pair stays in sync via the `test_cocoindex_flow_failure_mode.py` tests
# that enumerate each class verbatim.
_PIPELINE_ERROR_CLASSES: tuple[str, ...] = (
    "extraction_validation_failed",
    "extraction_provider_unavailable",
    "postgres_write_failed",
    "binary_conversion_failed",
    "embedding_failed",
    "entity_resolution_failed",
)


# UUID regex used by `_emit_stage_error_log()` for PII redaction. Matches
# v4-style canonical UUIDs in lowercase or uppercase. The pattern is
# anchored on `\b`-style hex-digit boundaries via the surrounding non-hex
# characters in the typical error-message context.
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
)


def _classify_stage_exception(exc: BaseException) -> str | None:
    """Map a Python exception to the Inv-25 6-class stage-level vocabulary.

    Returns the canonical class string when the exception type matches a
    known stage-failure pattern, or `None` when the exception is unmapped
    (the caller is then free to fall back to the exception class name or
    treat it as an internal failure).

    Mappings (per TECH.md §P-8 + the ID-28.13 dispatch brief):

      - `pydantic.ValidationError`        → `extraction_validation_failed`
      - `anthropic.APIStatusError`        → `extraction_provider_unavailable`
      - `anthropic.APIConnectionError`    → `extraction_provider_unavailable`
      - `anthropic.APIError` (other)      → `extraction_provider_unavailable`
      - `asyncpg.PostgresError`           → `postgres_write_failed`
      - `docling.*` (any docling-raised)  → `binary_conversion_failed`

    Embedding-stage + entity-resolution-stage classes (`embedding_failed`,
    `entity_resolution_failed`) are NOT auto-classified at v1: their
    upstream exception types (LiteLLM proxy / entity_resolution function)
    are not yet wired in flow.py (Stages 4+5 stubs per docstring). Once
    those stages land, this mapper grows two more branches.

    Args:
      exc: The exception instance to classify.

    Returns:
      One of the 6 canonical class strings, or `None` for unmapped types.
    """
    # Pydantic validation (Stage 3 LLM-extraction failure surface).
    try:
        from pydantic import ValidationError as _PydanticValidationError

        if isinstance(exc, _PydanticValidationError):
            return "extraction_validation_failed"
    except ImportError:  # pragma: no cover — pydantic is required at runtime
        pass

    # Anthropic provider surface (Stage 3 LLM-extraction provider failure).
    # APIConnectionError is a sibling of APIStatusError (not a subclass) —
    # both inherit from APIError. We accept any APIError to cover the full
    # provider-side surface.
    try:
        import anthropic as _anthropic

        if isinstance(exc, _anthropic.APIError):
            return "extraction_provider_unavailable"
    except ImportError:  # pragma: no cover — anthropic is required at runtime
        pass

    # asyncpg Postgres surface (Stage 6 UPSERT failure). Guard the
    # isinstance call against `asyncpg.PostgresError` being a non-class
    # mock under unit-test stubbing — flow.py is imported by tests that
    # install MagicMock asyncpg modules; the real prod import always
    # resolves to the asyncpg package's exception class.
    _postgres_error_cls = getattr(asyncpg, "PostgresError", None)
    if isinstance(_postgres_error_cls, type) and isinstance(
        exc, _postgres_error_cls
    ):
        return "postgres_write_failed"

    # Docling surface (Stage 2 binary-conversion failure). Docling has no
    # single exception-class hierarchy; classify by module-name prefix
    # over the exception's defining module instead.
    exc_module = type(exc).__module__ or ""
    if exc_module.startswith("docling"):
        return "binary_conversion_failed"

    return None


def _redact_error_message(msg: str, *, max_length: int = 200) -> str:
    """Apply PII redaction to a stage-error message for structured logging.

    Two steps (per Inv-26 + ID-28.13 brief):
      1. Replace UUID-shaped substrings with the placeholder `<uuid>` so
         per-row identifiers don't leak through error messages — operator
         forensic correlation is via the structured-log `op_id` /
         `content_items_id` fields, not the message body.
      2. Truncate to `max_length` (default 200) characters so provider
         5xx responses that echo user-supplied payloads cannot bloat the
         log surface.

    Args:
      msg:        The raw error message (typically `str(exc)`).
      max_length: Maximum length of the redacted message (default 200).

    Returns:
      The redacted, truncated message safe for structured-log emission.
    """
    redacted = _UUID_RE.sub("<uuid>", msg)
    if len(redacted) > max_length:
        redacted = redacted[:max_length]
    return redacted


def _emit_stage_error_log(
    *,
    op_id: uuid.UUID | str,
    stage: str,
    error_class: str,
    content_items_id: uuid.UUID | str | None,
    error_message: str,
) -> None:
    """Emit one Cloud-Run-parseable structured ERROR log per stage failure.

    Inv-26: every failed pipeline invocation emits at least one ERROR-level
    structured-log line in addition to the `pipeline_runs.status='failed'`
    rollup row. Contract shape:

      {"event": "cocoindex.stage_error", "op_id": "<uuid>",
       "stage": "<stage>", "error_class": "<one of PIPELINE_ERROR_CLASSES>",
       "content_items_id": "<uuid>"|null,
       "error_message": "<truncated to 200 chars, UUIDs redacted>"}

    PII redaction: `error_message` is truncated + has UUID-shaped
    substrings replaced with `<uuid>`. Operator forensic correlation is
    via the structured `op_id` / `content_items_id` fields.
    """
    payload: dict[str, object | None] = {
        "event": "cocoindex.stage_error",
        "op_id": str(op_id),
        "stage": stage,
        "error_class": error_class,
        "content_items_id": (
            str(content_items_id) if content_items_id is not None else None
        ),
        "error_message": _redact_error_message(error_message),
    }
    _logger.error(json.dumps(payload))


# ── Inv-23 retry-count substrate (ID-28.13 fix-pack) ─────────────────────────


class _FlowRetryCounter:
    """Per-flow retry counter for Inv-23 observability.

    `.increment()` is called from `_anthropic_retry` (extraction.py) via
    the tenacity `before_sleep` hook each time a transient Anthropic
    error is retried; `.get()` is read at flow end and emitted via the
    pipeline-run webhook. Instances are per-flow — one per `app_main()`
    invocation, no shared state. Thread-safety is not required: cocoindex
    @coco.fn execution is sequential per content row.

    cocoindex 1.0.3 has no public retry primitive on either the postgres
    connector or @coco.fn extractors; KH owns the surface here (see
    module docstring for the empirical provenance).
    """

    def __init__(self) -> None:
        self._count: int = 0

    def increment(self) -> None:
        self._count += 1

    def get(self) -> int:
        return self._count


# ── Inv-17 stage-count substrate (ID-49.4 — embedding observability) ─────────


class _FlowStageCounter:
    """Per-flow stage counter for Inv-17 observability.

    `.increment(stage)` is called from `ingest_file` (via the
    `bind_stage_counter()` contextvar binding `app_main` wraps `mount_each`
    in) each time a stage produces an output for one item; `.get(stage)` is
    read at flow end and folded into `stage_counts` before the pipeline-run
    webhook emit. Instances are per-flow — one per `app_main()` invocation,
    no shared state. Thread-safety is not required: cocoindex @coco.fn
    execution is sequential per content row.

    At v1 the only wired stage is `"embedding"` (Inv-17 gap closure inherited
    from ID-49.2). Keys are the canonical stage names from
    `_empty_stage_counts()`; an unbumped stage reads back as 0.
    """

    def __init__(self) -> None:
        self._counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self._counts[stage] = self._counts.get(stage, 0) + 1

    def get(self, stage: str) -> int:
        return self._counts.get(stage, 0)


# ── Inv-16 / Inv-17 / Inv-18 rollup substrate (P-7 — ID-28.11) ───────────────


PipelineRunStatus = Literal[
    "in_progress",
    "completed",
    "completed_with_errors",
    "failed",
]


def _empty_stage_counts() -> dict[str, int]:
    """Return the canonical six-stage counter map initialised to zero.

    The six stages mirror the canonical pipeline topology per
    `02-data-flow.md` §3.1. The webhook route (`POST
    /api/internal/pipeline-runs/record`) enforces ALL six keys via Zod, so
    every emission MUST supply the full map (even zeros).
    """
    return {
        "source_walk": 0,
        "binary_conversion": 0,
        "llm_extraction": 0,
        "embedding": 0,
        "entity_resolution": 0,
        "postgres_upsert": 0,
    }


# ── Inv-16 / Inv-17 stage-count recorders (P-7 — ID-28.16) ───────────────────


def _record_extraction_success(
    *,
    stage_counts: dict[str, int],
    items_created: list[str],
    content_items_id: uuid.UUID | str,
) -> None:
    """Record one successful LLM-extraction pass.

    Increments `stage_counts['llm_extraction']` and appends the
    stringified `content_items_id` to `items_created` (de-duplicated per
    row — Inv-4 idempotency).

    Per the ID-28.16 brief acceptance: "stage_counts['llm_extraction']
    reflects extraction count per flow run" + "items_created[] populated
    with content_items_id list per flow run". Each `.transform()`-fed
    extractor invocation calls this helper once on success.

    The 3-extractor pattern (classification + qa_form + entity_mentions)
    fires THREE times per content_items row, so `stage_counts['llm_extraction']`
    accumulates per pass while `items_created` records each row exactly
    once (idempotency contract per Inv-4).

    Args:
      stage_counts:     Per-stage counter dict (mutated in-place).
      items_created:    List of created content_items_id strings (mutated in-place).
      content_items_id: The row whose content was extracted from.

    PRODUCT invariants honoured:
      - Inv-16 (one pipeline_runs row per invocation rollup).
      - Inv-17 (stage_counts populated for forensic observability).
      - Inv-4 (idempotency — items_created de-duplicated per row).
    """
    stage_counts["llm_extraction"] += 1
    cid_str = str(content_items_id)
    if cid_str not in items_created:
        items_created.append(cid_str)


def _record_extraction_failure(
    *,
    stage_counts: dict[str, int],
    items_created: list[str],
    content_items_id: uuid.UUID | str,
) -> None:
    """Record one failed LLM-extraction pass.

    Per Inv-25/Inv-26: failed extractions DO NOT increment
    `stage_counts['llm_extraction']` — failures route through the rollup
    webhook's `error_class` field and the structured-log stream
    (`_emit_stage_error_log`).

    The body is an intentional no-op; the symmetric signature mirrors
    `_record_extraction_success()` so call-sites declare intent explicitly.
    Future versions may add per-failure counters without breaking the
    call-site contract.
    """
    _ = (stage_counts, items_created, content_items_id)  # unused at v1


async def _emit_pipeline_run_webhook(
    *,
    op_id: uuid.UUID | str,
    status: PipelineRunStatus,
    stage_counts: dict[str, int],
    items_processed: int,
    items_created: list[str],
    error_message: str | None = None,
    error_class: str | None = None,
    extractor_version: str | None = None,
    retry_count: int | None = None,
    pipeline_name: str = "kh_canonical_pipeline",
) -> None:
    """POST a pipeline-run rollup to the Vercel webhook.

    Inv-16/17/18 (TECH.md §P-7 Option α): the sidecar emits one HTTP POST
    per flow lifecycle event — `status='in_progress'` at flow start, then
    one of the three terminal statuses at flow end. The receiving Vercel
    route is the ONLY path used to land `pipeline_runs` rows (Inv-18
    discipline guard).

    Auth: `Authorization: Bearer <CRON_SECRET>` (T-OQ2; secret mounted via
    Cloud Run Secret Manager).

    Best-effort: missing env vars or HTTP errors are logged but DO NOT
    raise — the pipeline keeps running even if the webhook is unreachable.

    `retry_count` semantics: `None` means "field omitted entirely",
    distinguishable from `retry_count=0` (the no-retry happy path) by the
    Vercel route's `!== undefined` discriminator. Source of truth is the
    per-flow `_FlowRetryCounter`.

    Env vars (set by Cloud Run Service manifest):
      PIPELINE_RUN_WEBHOOK_URL — full URL of the Vercel route.
      CRON_SECRET              — shared bearer secret.
    """
    url = os.environ.get("PIPELINE_RUN_WEBHOOK_URL")
    secret = os.environ.get("CRON_SECRET")
    if not url or not secret:
        _logger.warning(
            "PIPELINE_RUN_WEBHOOK_URL or CRON_SECRET not set — skipping "
            "pipeline-run webhook emission (op_id=%s status=%s). "
            "Per-row structured logs via _emit_upsert_log() are unaffected.",
            op_id,
            status,
        )
        return

    payload: dict[str, Any] = {
        "opId": str(op_id),
        "pipelineName": pipeline_name,
        "status": status,
        "itemsProcessed": items_processed,
        "itemsCreated": list(items_created),
        "stageCounts": stage_counts,
    }
    if error_message is not None:
        payload["errorMessage"] = error_message
    if error_class is not None:
        payload["errorClass"] = error_class
    if extractor_version is not None:
        payload["extractorVersion"] = extractor_version
    # `retry_count=0` is meaningful (no-retry happy path) — use `is not None`
    # so 0 lands verbatim, mirroring the route's `!== undefined` check.
    if retry_count is not None:
        payload["retryCount"] = retry_count

    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status >= 400:
                    body_preview = await resp.text()
                    _logger.error(
                        "pipeline-run webhook returned HTTP %d "
                        "(op_id=%s status=%s body_preview=%r)",
                        resp.status,
                        op_id,
                        status,
                        body_preview[:200],
                    )
    except Exception as exc:  # noqa: BLE001 — best-effort emission
        _logger.error(
            "pipeline-run webhook emission failed (op_id=%s status=%s): %s",
            op_id,
            status,
            exc,
        )


# asyncpg.Pool context key — shared across mount_table_target calls in app_main()
# and provided env-scope by `kh_pipeline_lifespan` (28.22).


def _build_db_ctx() -> "coco.ContextKey[asyncpg.Pool]":
    """Build (or reuse) the DB_CTX ContextKey defensively.

    Mirrors the `_build_flow_meta_ctx()` pattern in flow_context.py.

    `cocoindex.ContextKey` enforces process-global uniqueness on the key string.
    If `flow.py` is imported under two package paths in one process (e.g.
    `scripts.cocoindex_pipeline.flow` AND `cocoindex_pipeline.flow` via
    `sys.path.insert`), the second `ContextKey(...)` call trips the registry.
    We catch the resulting `ValueError` and rebuild an identity-equivalent
    instance via `__new__` so both sys.modules entries share the same logical
    handle. (ID-49.7 duplicate-key defence.)
    """
    key_str = "kh_pipeline_db"
    try:
        return coco.ContextKey(key_str)
    except ValueError:
        ck: coco.ContextKey[asyncpg.Pool] = coco.ContextKey.__new__(  # type: ignore[assignment]
            coco.ContextKey
        )
        ck._key = key_str  # type: ignore[attr-defined]
        ck._detect_change = False  # type: ignore[attr-defined]
        return ck


DB_CTX: coco.ContextKey[asyncpg.Pool] = _build_db_ctx()


# ── Stage-4 embedding (ID-49.2) ──────────────────────────────────────────────
# OQ-B REVERSAL (S272, confirmed by Liam — sequencing doc §2.5 wins over the
# older S265 ledger text): use the CocoIndex-shipped LiteLLMEmbedder, NOT a
# KH-owned embedder. text-embedding-3-large is natively 3072-dim; the
# `dimensions=1024` param truncates server-side (OpenAI -3 models support it) to
# match the `vector(1024)` content_items.embedding column.
#
# Invoked IMPERATIVELY: `LiteLLMEmbedder.embed(text)` is a @coco.fn(memo=True)
# async method whose engine wrapper (`_BoundAsyncMethod.__call__`) `await`s the
# original coroutine directly — so a plain `await embedder.embed(text)` inside
# `ingest_file`'s body returns a numpy float32 vector with NO flow-scope
# `.transform()` chaining (which is fictional in 1.0.3, per RESEARCH §R2/§R3).
EMBEDDING_MODEL = "text-embedding-3-large"
EMBEDDING_DIMENSIONS = 1024

# Module-level singleton: the embedder memoises its dim probe + per-text memo
# cache, so one shared instance per process is correct. OPENAI_API_KEY is read
# by litellm from the environment at call time (and at schema-resolution time if
# __coco_vector_schema__ is ever invoked).
#
# `LiteLLMEmbedder` is imported LAZILY (inside `_get_embedder`), NOT at module
# top-level: `cocoindex.ops.litellm` is an optional submodule, and several flow
# test files stub `cocoindex` as a bare MagicMock without registering the
# `cocoindex.ops` subtree. A top-level import would break their collection while
# the embedder is only ever needed at ingest call time. This mirrors the
# `import_module(f"{__package__}.flow_context")` lazy-import idiom in this file.
_EMBEDDER: object | None = None


def _get_embedder() -> object:
    """Return the process-wide LiteLLMEmbedder, instantiating on first use."""
    global _EMBEDDER
    if _EMBEDDER is None:
        from cocoindex.ops.litellm import LiteLLMEmbedder  # noqa: PLC0415

        _EMBEDDER = LiteLLMEmbedder(
            EMBEDDING_MODEL,
            dimensions=EMBEDDING_DIMENSIONS,
        )
    return _EMBEDDER


async def embed_content_text(content_text: str) -> list[float]:
    """Embed `content_text` into a length-1024 float vector (Stage 4).

    Calls `LiteLLMEmbedder.embed(...)` imperatively and returns a plain
    `list[float]` (the pgvector wire-format encoder on the `embedding` ColumnDef
    serialises it for asyncpg). The returned numpy array's length is asserted to
    be exactly `EMBEDDING_DIMENSIONS` — a contract mismatch (e.g. an embedder
    misconfigured to its native 3072-dim) raises loudly rather than silently
    writing a wrong-width vector that the `vector(1024)` column would reject at
    INSERT or that would corrupt cosine search. NOT papered over with a bare
    except (S270 landmine).
    """
    vector = await _get_embedder().embed(content_text)
    values = [float(v) for v in vector]
    if len(values) != EMBEDDING_DIMENSIONS:
        raise ValueError(
            f"embedding dimension mismatch: expected {EMBEDDING_DIMENSIONS}, "
            f"got {len(values)} from model {EMBEDDING_MODEL!r}"
        )
    return values


def _encode_pgvector(value: list[float]) -> str:
    """Encode a float list into the pgvector text literal `[v1,v2,...]`.

    asyncpg has no native pgvector codec; pgvector's input function accepts the
    bracketed text form for a `vector` column, so the ColumnDef encoder converts
    the Python list to that literal before asyncpg binds it.
    """
    return "[" + ",".join(repr(float(v)) for v in value) + "]"


# ── TableSchema declarations ─────────────────────────────────────────────────
# NOTE: content_text_hash is GENERATED ALWAYS in Postgres — OMIT from
# TableSchema (explicit insert/update rejected with SQLSTATE 428C9 per
# CLAUDE.md gotcha). PG auto-computes via md5(normalised content).

CONTENT_ITEMS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "content_text": ColumnDef(type="text", nullable=True),
        "embedding": ColumnDef(
            type="vector(1024)",
            nullable=True,
            encoder=_encode_pgvector,
        ),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
        "source_document_id": ColumnDef(type="uuid", nullable=True),
        # content_text_hash GENERATED ALWAYS — OMITTED per CLAUDE.md gotcha
    },
    primary_key=("id",),
)

Q_A_EXTRACTIONS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "source_content_item_id": ColumnDef(type="uuid", nullable=True),
        "extractor_kind": ColumnDef(type="text", nullable=False),
        "extracted_question_text": ColumnDef(type="text", nullable=False),
        "extracted_answer_text": ColumnDef(type="text", nullable=True),
        "extraction_metadata": ColumnDef(type="jsonb", nullable=False),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
    },
    primary_key=("id",),
)

SOURCE_DOCUMENTS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "storage_path": ColumnDef(type="text", nullable=False),
        "content_fingerprint": ColumnDef(type="text", nullable=True),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
    },
    primary_key=("id",),
)

# ID-53 §P-4 (Inv-6). Stage-5 entity-resolution writes entity_mentions rows via
# `em_target` declared per-doc inside `ingest_file` (mounted at app_main below).
# `op_id` is a plain row field — stamped from `current_flow_meta()` — that
# round-trips into `pipeline_runs` per Inv-6. PG-defaulted columns
# (`created_at`, `entity_type_override`, `normalisation_version`) are OMITTED
# per the existing `content_text_hash GENERATED ALWAYS` convention — explicit
# INSERTs of those columns would either duplicate the PG default behaviour or
# (for the GENERATED ALWAYS family) raise SQLSTATE 428C9.
ENTITY_MENTIONS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "content_item_id": ColumnDef(type="uuid", nullable=False),
        "entity_type": ColumnDef(type="text", nullable=False),
        "entity_name": ColumnDef(type="text", nullable=False),
        "canonical_name": ColumnDef(type="text", nullable=False),
        "confidence": ColumnDef(type="numeric", nullable=True),
        "context_snippet": ColumnDef(type="text", nullable=True),
        "metadata": ColumnDef(type="jsonb", nullable=True),
        "op_id": ColumnDef(type="uuid", nullable=True),  # §P-9 migration
    },
    primary_key=("id",),
)


# ── DSN helper ───────────────────────────────────────────────────────────────


# Region-qualified Supabase pooler host shape. Supavisor hosts are
# `aws-<n>-<region>.pooler.supabase.com` (e.g. aws-1-eu-west-2.pooler.supabase.com).
# The previous code fabricated `<project-ref>.pooler.supabase.com`, which has
# never existed in DNS (NXDOMAIN -> asyncpg gaierror -2, crashing the worker at
# boot). This regex is the regression guard: a valid pooler host MUST match it;
# the old ref-derived host MUST NOT. See ID-49.8 +
# docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md.
POOLER_HOST_RE = r"^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$"


def _build_dsn() -> str:
    """Return the Postgres DSN from the COCOINDEX_DB_DSN env var.

    Reads an EXPLICIT, fully-formed pooler connection string mounted via Cloud
    Run Secret Manager (audit §7.1 "preferred"). The DSN already carries host +
    user + password + port, so there is NO host reconstruction — the previous
    `<project-ref>.pooler.supabase.com` derivation was the root cause of the
    boot crash (NXDOMAIN -> asyncpg gaierror -2) and the wrong-password defect
    (it used SUPABASE_SERVICE_ROLE_KEY, a PostgREST JWT, as the Postgres
    password). Both are subsumed by reading the explicit DSN directly.

    The real value (region-qualified pooler URL + the Postgres/pooler password)
    is minted out-of-band and mounted as the COCOINDEX_DB_DSN secret in
    .github/workflows/cloud-run-deploy.yml.

    No silent fallback: an unset/empty COCOINDEX_DB_DSN raises RuntimeError
    rather than reconstructing the broken host (KH no-silent-failure ethos).

    References:
      docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md §7.1
      ID-49.8 (task-list.json task 49, subtask 8)
    """
    dsn = os.environ.get("COCOINDEX_DB_DSN", "")

    if not dsn:
        raise RuntimeError(
            "COCOINDEX_DB_DSN env var is required and must be a fully-formed "
            "Supabase pooler connection string "
            "(postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres). "
            "Mount via Cloud Run Secret Manager per ID-49.8 "
            "(.github/workflows/cloud-run-deploy.yml cocoindex-secrets block). "
            "Do NOT derive the host from SUPABASE_URL — "
            "`<ref>.pooler.supabase.com` is NXDOMAIN (see "
            "docs/audits/cocoindex-state-db-connection-crash-2026-05-26.md)."
        )

    return dsn


# ── Per-source-item ingest component (Stage 1→6 for one file) ────────────────


def _field(obj: object, name: str, default: Any = None) -> Any:
    """Read ``name`` off a Pydantic model (attribute) or a plain dict (key).

    The Path A extractors return Pydantic models in production
    (`ClassificationExtraction` / `QAFormExtraction` / `EntityMentionExtraction`);
    the deterministic write-path test stubs return plain dicts. Reading through
    this helper keeps `ingest_file` agnostic to which shape it receives — the
    write-path SHAPE is what this slice proves, not the extraction internals.
    """
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


# Fixed namespace for deterministic per-DOCUMENT primary keys. The PK is a
# uuid5 of (this namespace, the document's rel_path) — a function of the
# DOCUMENT identity ONLY, independent of the per-run op_id. This is the
# substrate for PRODUCT Inv-4 idempotency + ratified OQ-A: re-ingesting the
# same document on a LATER run mints the SAME PK, so `declare_row` UPSERTs
# (UPDATEs) the existing row and re-stamps its op_id field — it does NOT
# insert a duplicate. Seeding the PK with the per-run op_id (a fresh uuid4
# each run) would mint a new PK every run → duplicate rows, breaking re-ingest.
# Derived once as uuid5(NAMESPACE_DNS, "kh-pipeline.cocoindex.document-identity.v1")
# and pinned here so the value is stable across processes and deploys.
_KH_PIPELINE_DOC_NS = uuid.UUID("fbfaf1ff-1ee4-583c-9757-1674465b2ec1")


@coco.fn(memo=True)
async def ingest_file(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    ci_target: Any,
    qa_target: Any,
    sd_target: Any,
    em_target: Any,
) -> None:
    """Ingest ONE source file: convert → extract → declare rows on each target.

    Mounted once per source item by `coco.mount_each`. cocoindex 1.0.3 calls
    this component as `ingest_file(File, ci, qa, sd, em)` — the item VALUE (the
    `File`) is the first positional arg, followed by the extra args
    (`ci/qa/sd/em` targets) passed positionally to `mount_each`. The (key,value)
    pair from `walk_dir().items()` is `(relative_path_str, File)`; the KEY is
    consumed by `mount_each` for per-item subpath routing only and is NOT
    passed to `fn` (verified against installed cocoindex 1.0.3
    `_internal/api.py` `_mount_one`: `fn(item, *extra_args)`). The stable
    per-document identity is therefore derived INSIDE the body from
    `file.file_path.path` — there is no `rel_path` parameter.

    This is the reactive 1.0.3 write path proven in RESEARCH.md §R2/§R3 — the
    per-MIME conversion (Stage 2, P-3) and Path A extraction (Stage 3) run as
    plain awaits INSIDE the component body (NOT flow-scope `.transform()`
    chaining, which is fictional in 1.0.3), and each row lands via
    `TableTarget.declare_row(row=...)` (Stage 6).

    `op_id` is a PLAIN ROW FIELD, read from the currently-bound `FLOW_META_CTX`
    via `current_flow_meta()` — NOT the fictional `bind_target(op_id=flow['op_id'])`.
    `content_text_hash` is OMITTED (GENERATED ALWAYS column). `embedding` is now
    a real text-embedding-3-large vector(1024) computed from content_text via
    `embed_content_text()` (Stage 4 — ID-49.2); per-row upsert logging (28.25) is
    still deferred and wired in a later subtask.

    @coco.fn(memo=True): the component is skipped on unchanged source bytes, so
    `declare_row` is not re-invoked and the row's op_id retains the value from the
    run that last materially changed it (RESEARCH.md §R4 — Inv-11 refinement).
    """
    # Resolve current_flow_meta via flow's OWN package namespace. flow.py may be
    # imported under BOTH `scripts.cocoindex_pipeline.flow` (runtime) AND
    # `cocoindex_pipeline.flow` (pytest pythonpath) — each pulls its own
    # flow_context module object with separate ContextVar storage. Reading
    # through `__package__` resolves to whichever namespace the caller bound the
    # meta under (same rationale as `stamp_extraction_base` in extraction.py).
    from importlib import import_module

    flow_context_module = import_module(f"{__package__}.flow_context")
    meta = flow_context_module.current_flow_meta()
    if meta is None:
        raise RuntimeError(
            "ingest_file invoked without an active FLOW_META_CTX binding — "
            "app_main must wrap mount_each in `async with bind_flow_meta(op_id=...)`."
        )
    op_id = meta.op_id

    # Stable per-document path identity, derived FROM the `File` (NOT a phantom
    # param). `mount_each` passes only the item VALUE (the `File`) to `fn`; the
    # (key,value) key — the relative-path string from `walk_dir().items()` — is
    # consumed by mount_each for subpath routing and never reaches `fn` (1.0.3
    # `_internal/api.py` `_mount_one`: `fn(item, *extra_args)`). `file_path.path`
    # is the path relative to the source base dir (cocoindex `FilePath.path`);
    # `.as_posix()` gives the stable string used as the storage_path and the
    # seed of the deterministic per-file UUIDs below.
    rel_path = file.file_path.path.as_posix()

    # ── Stage 2: binary → markdown (per-MIME adapter, P-3) ──────────────────
    content_text = await convert_binary_to_markdown(file)

    # ── Stage 3: Path A extraction (direct anthropic inside @coco.fn) ───────
    classification = await extract_classification(content_text)
    qa_form = await extract_qa_form(content_text)
    # entity_mentions extraction runs here for memo coverage; entity-table
    # persistence is a downstream concern (28.13+), so the result is not yet
    # declared into a target at this slice.
    await extract_entity_mentions(content_text)

    # ── Stage 6: declare rows (managed_by=USER row-level upserts) ───────────
    # Deterministic per-DOCUMENT UUIDs seeded on the FIXED namespace + rel_path
    # (NOT op_id), so re-ingesting the same document on any LATER run declares
    # the SAME primary keys → declare_row UPSERTs the existing row and re-stamps
    # its op_id field (PRODUCT Inv-4 idempotency + ratified OQ-A). op_id stays a
    # plain ROW FIELD that identifies the run; it is NOT part of the PK.
    source_document_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")
    content_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")

    # content_fingerprint is an ASYNC METHOD on FileLike returning bytes
    # (cocoindex resources/file.py L172 → connectorkits.fingerprint); await it
    # and encode to hex so it lands in the `text` content_fingerprint column.
    content_fingerprint = (await file.content_fingerprint()).hex()

    sd_target.declare_row(
        row={
            "id": source_document_id,
            "storage_path": rel_path,
            "content_fingerprint": content_fingerprint,
            "op_id": op_id,
        }
    )

    # ── Stage 4: embedding (text-embedding-3-large → vector(1024), ID-49.2) ──
    # Computed imperatively from the Stage-2 content_text (see embed_content_text
    # docstring). content_text_hash OMITTED (GENERATED ALWAYS); the pgvector
    # text-literal encoding is applied by the `embedding` ColumnDef encoder.
    embedding = await embed_content_text(content_text)
    ci_target.declare_row(
        row={
            "id": content_item_id,
            "content_text": content_text,
            "embedding": embedding,
            "source_document_id": source_document_id,
            "op_id": op_id,
        }
    )
    # Inv-17: bump the flow-scope embedding stage counter so
    # `stage_counts["embedding"]` surfaces truthfully in the flow-end webhook
    # (the gap inherited from ID-49.2 — the counter was initialised to 0 and
    # never incremented). Resolved via flow's OWN package namespace
    # (`flow_context_module`, bound at the top of ingest_file) so the bump
    # writes to the SAME ContextVar `app_main` bound under `bind_stage_counter`
    # (dual-import-path hazard — same rationale as current_flow_meta). When no
    # counter is bound (unit tests outside the binding), the bump is silently
    # skipped — the embedding still lands, only observability is omitted (same
    # graceful-degradation contract as the retry counter).
    stage_counter = flow_context_module.current_stage_counter()
    if stage_counter is not None:
        stage_counter.increment("embedding")

    content_type = _field(classification, "content_type")
    qa_pairs = _field(qa_form, "qa_pairs", []) or []
    for idx, pair in enumerate(qa_pairs):
        qa_target.declare_row(
            row={
                "id": uuid.uuid5(_KH_PIPELINE_DOC_NS, f"qa:{rel_path}:{idx}"),
                "source_content_item_id": content_item_id,
                "extractor_kind": content_type or "q_a_form",
                "extracted_question_text": _field(pair, "question_text", ""),
                "extracted_answer_text": _field(pair, "answer_text"),
                "extraction_metadata": {
                    "extraction_kind": _field(qa_form, "extraction_kind", "q_a_form"),
                    "qa_index": idx,
                    "rel_path": rel_path,
                },
                "op_id": op_id,
            }
        )


# ── Main pipeline function ───────────────────────────────────────────────────


async def app_main() -> None:
    """Canonical 6-stage cocoindex pipeline — main_fn for KH_PIPELINE_APP.

    Called by cocoindex's App update cycle. Six stages wired flow-scope
    (NOT @coco.fn-wrapped per cocoindex-extraction-contract TECH §3.1 B-3).

    O-Q8 idle-mode: if COCOINDEX_SOURCE_PATH is unset or points at a
    missing folder, logs an info message and returns cleanly (no raise).
    The Cloud Run Service stays running; cocoindex's live-fs-watch arms
    once the source-binding is set. T7 example-client first-ingest cutover sets
    COCOINDEX_SOURCE_PATH and restarts the Service post-T8-stable.
    """
    source_path_str = os.environ.get("COCOINDEX_SOURCE_PATH", "")
    if not source_path_str:
        _logger.info(
            "COCOINDEX_SOURCE_PATH not set — Service running in idle mode. "
            "Set COCOINDEX_SOURCE_PATH and restart Service when ready to "
            "stage files (T7 example-client first-ingest cutover)."
        )
        return

    source_path = Path(source_path_str)
    if not source_path.exists():
        _logger.info(
            "cocoindex source-binding folder missing or unset — Service "
            "running in idle mode. Set COCOINDEX_SOURCE_PATH and restart "
            "Service when ready to stage files. path=%s",
            source_path,
        )
        return

    # Rollup state (Inv-16 / Inv-17). cocoindex 1.0.3 exposes no per-stage
    # completion callbacks, so counters are aggregated at flow scope via the
    # `_record_extraction_success` / `_record_extraction_failure` helpers.
    # KH generates the run op_id (cocoindex does NOT emit one — RESEARCH §R9);
    # it is written as a plain row field by ingest_file via current_flow_meta().
    run_op_id: uuid.UUID = uuid.uuid4()
    stage_counts: dict[str, int] = _empty_stage_counts()
    items_created: list[str] = []
    extractor_version = os.environ.get("IMAGE_SHA")
    # Inv-23 retry-count substrate: counter is bound via `bind_retry_counter`
    # below so the tenacity `before_sleep` hook in `extraction.py` bumps it
    # on each Anthropic-503 retry; value is read at flow-end webhook emit.
    flow_retry_counter = _FlowRetryCounter()
    # Inv-17 stage-count substrate: counter is bound via `bind_stage_counter`
    # below so `ingest_file` bumps `"embedding"` each time it produces a
    # vector; its value is folded into `stage_counts["embedding"]` at flow-end
    # webhook emit. Closes the ID-49.2 gap where `stage_counts["embedding"]`
    # was initialised to 0 (via `_empty_stage_counts()`) but never incremented.
    flow_stage_counter = _FlowStageCounter()

    # Flow-start emission: `retry_count` is omitted (always 0 at flow start;
    # emitting 0 would suggest observability is present when it is not yet).
    await _emit_pipeline_run_webhook(
        op_id=run_op_id,
        status="in_progress",
        stage_counts=stage_counts,
        items_processed=0,
        items_created=[],
        extractor_version=extractor_version,
    )

    flow_status: PipelineRunStatus = "completed"
    flow_error_message: str | None = None
    flow_error_class: str | None = None

    try:
        # ── Stage 6 prep: mount the 3 row-level targets (managed_by=USER) ──
        # mount_table_target reads the asyncpg pool env-scope from DB_CTX
        # (provided by `kh_pipeline_lifespan` via EnvironmentBuilder.provide —
        # 28.22). managed_by=ManagedBy.USER: cocoindex writes rows only, never
        # DDL. KH migrations own the schema.
        ci_target = await mount_table_target(
            DB_CTX,
            "content_items",
            CONTENT_ITEMS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        qa_target = await mount_table_target(
            DB_CTX,
            "q_a_extractions",
            Q_A_EXTRACTIONS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        sd_target = await mount_table_target(
            DB_CTX,
            "source_documents",
            SOURCE_DOCUMENTS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        # ID-53 §P-4 (Inv-6). Per-doc Stage-5 writes land here; the row-construction
        # loop that consumes `em_target` ships at {53.11}.
        em_target = await mount_table_target(
            DB_CTX,
            "entity_mentions",
            ENTITY_MENTIONS_SCHEMA,
            managed_by=ManagedBy.USER,
        )

        # ── Stage 1: source walk (live fs-watch, nested recursive) ─────────
        # recursive=True required — default is False (CLAUDE.md gotcha).
        # live=True enables fs-watch for continuous incremental updates.
        source = localfs.walk_dir(
            source_path,
            live=True,
            recursive=True,
        )

        # ── Stages 2→6: reactive per-item fan-out via mount_each ───────────
        # One independent component PER source item (RESEARCH §R2/§R3, proven).
        # `ingest_file` runs Stage 2 (conversion) + Stage 3 (Path A extraction)
        # as plain awaits inside its body, then declares rows on each target
        # (Stage 6). Extra args (ci/qa/sd targets) are passed positionally after
        # the item value per the mount_each signature.
        #
        # `bind_flow_meta` makes the run's op_id available to `current_flow_meta()`
        # inside `ingest_file` (op_id is a plain row field — NOT a flow-scope
        # target binding, which is fictional in 1.0.3). `bind_retry_counter`
        # exposes the
        # per-flow retry counter that the tenacity `before_sleep` hook in
        # `extraction.py:_anthropic_retry` bumps on each Anthropic-503 retry.
        # `bind_stage_counter` (Inv-17) exposes the per-flow embedding counter
        # that `ingest_file` bumps once per produced vector. All three bindings
        # MUST wrap `mount_each` so the per-item `ingest_file` components run
        # inside the contextvar scope and their bumps reach the bound counters.
        async with bind_flow_meta(op_id=run_op_id, content_items_id=None):
            async with bind_retry_counter(flow_retry_counter):
                async with bind_stage_counter(flow_stage_counter):
                    handle = await coco.mount_each(
                        ingest_file,
                        source.items(),
                        ci_target,
                        qa_target,
                        sd_target,
                        em_target,
                    )
                    # Wait until every per-item component has processed (cold
                    # run) so the rollup webhook below reflects a settled state.
                    await handle.ready()

        # ── Stage 4: embedding (vector(1024)) — LANDED (ID-49.2) ───────────
        # `ingest_file` now computes a text-embedding-3-large vector(1024) from
        # content_text and declares it on content_items (see embed_content_text
        # + the Stage-4 block in ingest_file). The pgvector HNSW cosine index is
        # NOT declared here: it is migration-owned (idx_content_items_embedding,
        # pre-squash reconciliation migration). cocoindex's
        # `TableTarget.declare_vector_index(...)` would issue out-of-band CREATE
        # INDEX DDL via a vector_index attachment that is NOT gated by
        # managed_by=USER (the USER gate only suppresses table/column DDL) — that
        # conflicts with the "DDL via Supabase CLI migrations only" rule and the
        # row-only target contract, so the declaration route is deliberately
        # avoided. See the ID-49.2 journal OQ.

        # ── Stage 5: entity resolution — deferred (needs faiss; RESEARCH §R5)─

        # ── Inv-13: per-row upsert logging — deferred to 28.25 ─────────────
        # cocoindex 1.0.3 exposes no per-row UPSERT completion callback
        # (RESEARCH §R8); the `_emit_upsert_log()` substrate stays unwired here.
    except Exception as exc:  # noqa: BLE001 — capture for rollup status
        # Inv-16/17/18: failures still land a pipeline_runs row so the
        # invocation count stays honest. Inv-25: classify the exception to
        # one of the 6 canonical classes; unmapped types fall back to the
        # Python class name + an `unclassified` marker log so the Vercel
        # route's Zod validator surfaces drift as a loud 4xx.
        flow_status = "failed"
        flow_error_message = str(exc)
        classified = _classify_stage_exception(exc)
        if classified is not None:
            flow_error_class = classified
        else:
            flow_error_class = type(exc).__name__
            _logger.error(
                json.dumps(
                    {
                        "event": "cocoindex.stage_error.unclassified",
                        "op_id": str(run_op_id),
                        "exception_type": type(exc).__name__,
                        "exception_module": type(exc).__module__,
                    }
                )
            )

        # Inv-26: structured error-log emission. Stage is "flow" at this
        # level; granular per-stage handlers wait on cocoindex 1.0.x
        # per-stage completion callbacks.
        _emit_stage_error_log(
            op_id=run_op_id,
            stage="flow",
            error_class=flow_error_class,
            content_items_id=None,
            error_message=flow_error_message,
        )
        raise
    finally:
        # NOTE: the asyncpg pool is NOT created/closed here — it is provisioned
        # env-scope by `kh_pipeline_lifespan` (28.22) and closed on App teardown.
        # Inv-17: fold the flow-scope embedding counter back into
        # `stage_counts["embedding"]` so the terminal webhook surfaces the real
        # count (the counter was bumped per produced vector inside the
        # `bind_stage_counter` scope above). Done in `finally` so partial-run
        # failures still report the embeddings that DID land before the failure.
        stage_counts["embedding"] = flow_stage_counter.get("embedding")
        # Flow-end emission (Inv-16 terminal row). `retry_count` reflects
        # real retry activity via the `bind_retry_counter` scope above.
        await _emit_pipeline_run_webhook(
            op_id=run_op_id,
            status=flow_status,
            stage_counts=stage_counts,
            items_processed=sum(stage_counts.values()) or 0,
            items_created=items_created,
            error_message=flow_error_message,
            error_class=flow_error_class,
            extractor_version=extractor_version,
            retry_count=flow_retry_counter.get(),
        )


# ── Env-scope DB pool provisioning (28.22) ───────────────────────────────────
# `coco.use_context(key)` is SINGLE-ARG read-only in 1.0.3 (RESEARCH §R1.7); the
# 2-arg async-CM form `use_context(DB_CTX, pool)` does not exist. Writes happen
# env-scope via `EnvironmentBuilder.provide(key, value)` inside a `@coco.lifespan`
# fn. `mount_table_target(DB_CTX, ...)` in `app_main` then resolves the pool from
# the environment.
#
# IDIOM (verified against the installed engine, not the §R2 sketch): the engine
# consumes async-generator lifespans natively — `LazyEnvironment._get_env` branches
# on `isasyncgenfunction(fn)` and `await anext(...)`s it on its OWN event loop. So
# the correct shape for an ASYNC asyncpg pool is an `async def` generator that
# `await asyncpg.create_pool(...)` directly. The §R2 sketch's
# `run_until_complete`-inside-a-sync-lifespan is WRONG here — it would attempt a
# nested `run_until_complete` on the already-running engine loop and raise
# `RuntimeError: This event loop is already running`. The async-gen form is both
# correct and simpler; `builder.provide_async_with` is reserved for a CM whose
# lifetime the engine should own directly (not needed — we close the pool in the
# generator's `finally`).


@coco.lifespan
async def kh_pipeline_lifespan(builder: coco.EnvironmentBuilder):
    """Provision the asyncpg pool env-scope for the App's lifetime.

    Creates the pool once on environment start, provides it under `DB_CTX` (so
    `mount_table_target` can resolve it), yields for the App lifetime, then closes
    the pool on teardown.
    """
    pool = await asyncpg.create_pool(_build_dsn(), min_size=2, max_size=10)
    try:
        builder.provide(DB_CTX, pool)
        yield
    finally:
        await pool.close()


# ── Module-level App declaration ─────────────────────────────────────────────
# `coco.App(config, main_fn)` registers the pipeline with the cocoindex
# environment. Used by `server.py` and the local-dev `__main__.py`.
# (cocoindex 1.0.3: `AppConfig` has NO `main_fn` field — see module docstring.)


KH_PIPELINE_APP = coco.App(
    coco.AppConfig(name="kh_pipeline"),
    app_main,
)


if __name__ == "__main__":
    asyncio.run(coco.start())
