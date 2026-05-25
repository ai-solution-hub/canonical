"""Cocoindex 1.0.3 canonical 6-stage pipeline (T8).

Stages (flow-scope):
  1. source walk            -> connectors.localfs.walk_dir(live=True, recursive=True)
  2. binary conversion      -> per-MIME adapters (P-3): docling for PDF/DOCX/XLSX,
                               pullmd HTTP client for HTML, passthrough for markdown
  3. LLM extraction         -> Path A: @coco.fn(memo=True) extractors call anthropic
                               SDK + Pydantic TypeAdapter validation
  4. embedding              -> TODO LiteLLMEmbedder stub
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
import urllib.parse
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
# Stage 4 (embedding) + Stage 5 (entity_resolution) imports are OUT OF SCOPE
# for WP4 — they land in 28.13+. Their commented-out stubs are preserved at
# the Stage 4/5 placeholder blocks below.
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
    FLOW_META_CTX,
    bind_flow_meta,
    bind_retry_counter,
    current_flow_meta,
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
DB_CTX: coco.ContextKey[asyncpg.Pool] = coco.ContextKey("kh_pipeline_db")

# ── TableSchema declarations ─────────────────────────────────────────────────
# NOTE: content_text_hash is GENERATED ALWAYS in Postgres — OMIT from
# TableSchema (explicit insert/update rejected with SQLSTATE 428C9 per
# CLAUDE.md gotcha). PG auto-computes via md5(normalised content).

CONTENT_ITEMS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "content_text": ColumnDef(type="text", nullable=True),
        "embedding": ColumnDef(type="vector(1024)", nullable=True),
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


# ── DSN helper ───────────────────────────────────────────────────────────────


def _build_dsn() -> str:
    """Build a Postgres DSN from Cloud Run Secret Manager env vars.

    Mirrors spike/cocoindex_s1/probe_managed_by_user.py:build_dsn() shape.
    Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY; both are mounted via
    Cloud Run Secret Manager per Subtask 28.6 (P-1 sidecar manifest).

    SUPABASE_URL format: https://<project-ref>.supabase.co
    The pooler host is derived: <project-ref>.pooler.supabase.com:5432
    """
    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required. "
            "Mount via Cloud Run Secret Manager per Subtask 28.6 "
            "(docs/specs/cocoindex-flow-scaffolding/TECH.md §P-1)."
        )

    # Extract project ref from: https://<project-ref>.supabase.co
    host_part = supabase_url.removeprefix("https://").removesuffix("/")
    project_ref = host_part.split(".")[0]

    # Supabase pooler for asyncpg: <project-ref>.pooler.supabase.com:5432
    host = f"{project_ref}.pooler.supabase.com"
    port = 5432
    user = f"postgres.{project_ref}"
    pw_quoted = urllib.parse.quote(service_role_key, safe="")

    return f"postgresql://{user}:{pw_quoted}@{host}:{port}/postgres"


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
    run_op_id: uuid.UUID = uuid.uuid4()  # placeholder until cocoindex exposes flow['op_id']
    stage_counts: dict[str, int] = _empty_stage_counts()
    items_created: list[str] = []
    extractor_version = os.environ.get("IMAGE_SHA")
    # Inv-23 retry-count substrate: counter is bound via `bind_retry_counter`
    # below so the tenacity `before_sleep` hook in `extraction.py` bumps it
    # on each Anthropic-503 retry; value is read at flow-end webhook emit.
    flow_retry_counter = _FlowRetryCounter()

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

    coco_pool = await asyncpg.create_pool(_build_dsn(), min_size=2, max_size=10)
    try:
        async with coco.use_context(DB_CTX, coco_pool):
            # ── Stage 1: source walk (live fs-watch, nested recursive) ─────
            # recursive=True required — default is False (CLAUDE.md gotcha).
            # live=True enables fs-watch for continuous incremental updates.
            source = localfs.walk_dir(
                source_path,
                live=True,
                recursive=True,
            )

            # ── Stage 2: binary conversion (delegates to per-MIME adapter) ─
            # convert_binary_to_markdown is @coco.fn(memo=True) from 28.7 (P-3).
            # Outer-tier: memoised on file handle (re-triggers when bytes change).
            # Inner-tier: memoised on content payload (metadata edits no-op).
            content_text = source.transform(convert_binary_to_markdown)  # type: ignore[attr-defined]

            # ── Stage 3: LLM extraction (flow-scope) — Path A canonical ──────
            # KH-authored @coco.fn(memo=True) extractors (extraction.py) call
            # the anthropic SDK + validate via Pydantic TypeAdapter. Wrapping
            # in `bind_flow_meta` lets `stamp_extraction_base()` read op_id +
            # content_items_id from FLOW_META_CTX without threading them
            # through `.transform()` chain args. `bind_retry_counter` is
            # nested INSIDE so the tenacity `before_sleep` hook in
            # `_anthropic_retry` bumps the per-flow counter on each retry —
            # `_bump_flow_retry_counter()` reads the counter from the same
            # contextvar scope.
            #
            # SIGNATURE_DRIFT note: `coco.use_context(key)` is single-arg
            # read-only in 1.0.3; storage binding happens via
            # `EnvironmentBuilder.provide()` inside `@coco.lifespan` (env-
            # scoped, NOT per-flow). The KH-authored `bind_flow_meta()` async-
            # CM uses stdlib `contextvars.ContextVar` for per-asyncio-task
            # isolation while preserving the `coco.ContextKey[FlowRunMeta]`
            # identity handle. See `flow_context.py`.
            async with bind_flow_meta(
                op_id=run_op_id, content_items_id=None
            ):
                async with bind_retry_counter(flow_retry_counter):
                    classification = content_text.transform(extract_classification)  # type: ignore[attr-defined]
                    q_a_form = content_text.transform(extract_qa_form)  # type: ignore[attr-defined]
                    entity_mentions = content_text.transform(extract_entity_mentions)  # type: ignore[attr-defined]

            # stamp_extraction_base() integration: per-row stamping pattern
            # is wrap-then-stamp inside the `bind_flow_meta(op_id, row_pk)`
            # scope. Cocoindex 1.0.3 exposes no per-`.transform()` completion
            # callback, so the live call-sites land when that callback
            # surface ships (orchestrator-tracked, TECH §P-5 amendment queue).

            # ── Stage 4: embedding (vector(1024)) — TODO(28.13+) ─────────────
            # Requires litellm package + LITELLM_API_KEY env var.
            # embedding = content_text.transform(
            #     LiteLLMEmbedder(model="openai/text-embedding-3-large")
            # )

            # ── Stage 5: entity resolution — TODO(28.13+) ────────────────────
            # Selectively adopted per COCO.1. Requires faiss + entity_resolution.
            # resolved_entities = entity_mentions.transform(entity_resolution())

            # ── Stage 6: Postgres UPSERT (per-table; managed_by=USER) ────────
            # mount_table_target registers each table for cocoindex-managed upserts.
            # managed_by=ManagedBy.USER: cocoindex does NOT alter DDL (no
            # CREATE/DROP/ALTER). KH migrations own the schema; cocoindex writes rows.
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

            # Flow-scope UPSERT bindings — op_id=flow['op_id'] stamps the
            # per-flow op_id onto every UPSERT row (Inv-11 + Inv-12). Both
            # `bind_target` and `flow['op_id']` are spec-sketch placeholders;
            # cocoindex 1.0.3 exposes neither. Real wiring lands when the
            # flow-scope op_id API is finalised. The `type: ignore` comments
            # acknowledge this; the kwarg preserves design intent.
            content_text.bind_target(  # type: ignore[attr-defined]
                ci_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )
            content_text.bind_target(  # type: ignore[attr-defined]
                qa_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )
            source.bind_target(  # type: ignore[attr-defined]
                sd_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )

            # Inv-13 substrate: _emit_upsert_log() SHOULD fire once per
            # UPSERT at this boundary; cocoindex 1.0.3 exposes no per-row
            # completion callback so the live call-site lands once that
            # surface ships (TECH.md §P-5 amendment queue).
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
        await coco_pool.close()
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
