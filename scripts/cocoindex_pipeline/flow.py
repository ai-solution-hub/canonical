"""Cocoindex 1.0.3 canonical 6-stage pipeline (T8) — per
02-data-flow.md §3.1 + cocoindex-extraction-contract TECH §3.1.

Stages (flow-scope):
  1. source walk            -> connectors.localfs.walk_dir(live=True, recursive=True)
  2. binary conversion      -> per-MIME adapters (P-3): docling for PDF/DOCX/XLSX,
                               pullmd HTTP client for HTML, passthrough for markdown
  3. LLM extraction         -> Path A: @coco.fn(memo=True) extractors call
                               anthropic SDK + Pydantic TypeAdapter validation
                               (S256 W1 / WP4 — extract_classification /
                               extract_qa_form / extract_entity_mentions).
  4. embedding              -> TODO(28.13+) LiteLLMEmbedder stub
  5. entity resolution      -> TODO(28.13+) entity_resolution stub
  6. Postgres UPSERT        -> postgres.mount_table_target(managed_by=ManagedBy.USER)
                               for content_items, q_a_extractions, source_documents

Source-binding folder: env var COCOINDEX_SOURCE_PATH (T8 ships EMPTY default;
T7 stages files post-T8 stable per O-Q8).

Latency budgets (per PRODUCT inv-2 + P-OQ4):
  - 35-file canonical corpus end-to-end ≤120 s (S2 cold-cache baseline)
  - per-file p95 ≤30 s

CLAUDE.md gotchas applied:
  - localfs.walk_dir(recursive=True)  (default is False)
  - cocoindex requires dangerouslyDisableSandbox in dev
  - content_items.content_text_hash is GENERATED ALWAYS — omit from TableSchema
  - recordPipelineRun() integration via per-flow op_id sidecar webhook (P-7)

Inv-13 v1 substrate (P-5):
  Per P-OQ1 ratification, v1 does NOT populate an `audit_log` table for
  pipeline-driven writes (DEFERRED-v1.1). The v1 audit-observability path
  is structured logs picked up by Cloud Run's jsonPayload ingest. The
  per-row emission contract is provided by `_emit_upsert_log()` — see
  helper below. Real per-row invocation lands when cocoindex 1.0.3
  exposes a Postgres-upsert completion callback at the bind_target site
  (see API deviation note below; orchestrator-tracked for 28.12 / Wave C
  TECH.md amendment).

Retry policy (per P-OQ2): cocoindex defaults (3 retries, exponential backoff, 1 s base).
No custom override at v1 — operational evidence post-v1 governs tuning.

Empirical retry-surface note (ID-28.13 verification against cocoindex 1.0.3):
  The spec's example "override per-stage via @coco.fn(memo=True, retries=N,
  backoff_base_ms=N)" was a TECH-sketch fiction — cocoindex.fn 1.0.3's public
  signature is `(fn, /, *, memo, memo_key, batching, max_batch_size, runner,
  version, logic_tracking, deps)` with NO `retries` or `backoff_base_ms`
  kwargs. The actual retry surface in 1.0.3 lives in connector-specific
  RetryConfig dataclasses (e.g. `cocoindex.connectors.doris.RetryConfig`
  defaults: max_retries=3, base_delay=1.0, max_delay=30.0,
  exponential_base=2.0 — matching the documented P-OQ2 semantic by
  coincidence in the doris connector). The postgres path used by
  `mount_table_target` inherits retry behaviour from the asyncpg connection
  pool + cocoindex's internal Rust engine; the public 1.0.3 surface does NOT
  expose a tuning hook. v1 accepts the engine defaults; if operational
  evidence demands tuning, the orchestrator should escalate to a TECH.md
  P-OQ2 amendment that reflects the real 1.0.3 surface (likely connector-
  scoped RetryConfig overrides rather than @coco.fn kwargs).

Failure-mode wiring (per P-8 / ID-28.13):
  - `_classify_stage_exception()` maps Python exception types to the
    Inv-25 6-class stage-level vocabulary (extraction_validation_failed,
    extraction_provider_unavailable, postgres_write_failed,
    binary_conversion_failed, embedding_failed, entity_resolution_failed).
  - `_emit_stage_error_log()` emits one PII-redacted structured-log line
    per stage exception per Inv-26 (event=cocoindex.stage_error;
    error_message truncated to 200 chars; UUID substrings redacted to
    <uuid>).
  - `app_main()`'s except-Exception block classifies via the helper, falling
    back to the exception class name for unmapped types so the
    `pipeline_runs.error_class` column never lands an unaudited string.

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2, §P-5, §P-8
  docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-23..Inv-27
  docs/plans/phase-0-investigation/architecture/02-data-flow.md §3.1
  spike/cocoindex_s1/probe_managed_by_user.py — canonical live-wiring shape

API deviation note (S254 / 28.8 discovery):
  TECH.md sketch shows coco.AppConfig(name=..., main_fn=...) — but in
  cocoindex 1.0.3, AppConfig has NO main_fn field. The correct pattern is
  coco.App(name_or_config, main_fn). KH_PIPELINE_APP uses coco.App() accordingly.
  coco.start() (no args) starts the default environment; coco.App.update() triggers
  the pipeline update cycle. This deviation is documented for 28.9 Checker review.

API deviation note (S255 / 28.10 discovery):
  TECH.md §P-5 brief assumes cocoindex 1.0.3 exposes a per-row UPSERT
  completion callback at the bind_target site. It does NOT — UPSERT
  application happens inside `TableTarget._apply_actions` (private
  cocoindex internal) via `coco.TargetActionSink.from_async_fn()`. There
  is no public hook to register a per-row completion observer at the
  mount_table_target API. Per established 28.8 / 28.9 spec-drift
  discipline, this Subtask lands the v1 helper contract
  (`_emit_upsert_log`) with the correct JSON shape + INFO-level stdlib
  emission, and documents the call-site at Stage 6. Real invocation is
  blocked on a public cocoindex callback surface; orchestrator-tracked
  for TECH.md §P-5 amendment + 28.12 / Wave C carry-forward.
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
# ────────────────────────────────────────────────────────────────────────────

_logger = logging.getLogger(__name__)

# Production LLM model tier per cocoindex-extraction-contract TECH §3.1
ANTHROPIC_MODEL = "claude-opus-4-6"


# ── Inv-13 v1 substrate helper (P-5) ─────────────────────────────────────────


def _emit_upsert_log(
    *,
    op_id: uuid.UUID | str,
    table: str,
    row_id: uuid.UUID | str,
    operation: Literal["INSERT", "UPDATE"],
) -> None:
    """Emit one Cloud-Run-parseable structured log line per Postgres UPSERT.

    Inv-13 v1 audit-observability substrate per TECH.md §P-5:
    the Cloud Run logging surface picks up JSON-formatted log lines and
    extracts them into `jsonPayload` automatically — no extra plumbing.

    Contract shape (5 keys, all required):
      {
        "event":     "cocoindex.upsert",
        "op_id":     "<uuid string>",
        "table":     "<table name>",
        "row_id":    "<uuid string>",
        "operation": "INSERT" | "UPDATE",
      }

    Per S254 amendment (commit 61e163d8): cocoindex 1.0.3 does NOT expose
    `coco.logger`; emission uses stdlib `logging.getLogger(__name__)`.

    Args:
      op_id:     cocoindex per-flow op_id (UUID v4); stringified for JSON.
      table:     Postgres table name (e.g. 'content_items').
      row_id:    Primary-key row id (UUID); stringified for JSON.
      operation: 'INSERT' or 'UPDATE' — cocoindex's per-row outcome.

    Invocation site:
      Per TECH.md §P-5, this helper SHOULD be called once per UPSERT at
      cocoindex's Stage 6 bind_target completion hook. Cocoindex 1.0.3
      does NOT expose a public per-row completion callback at this site
      (see module docstring API deviation note S255); real per-row
      invocation is deferred to a TECH.md §P-5 amendment + 28.12 / Wave C
      wiring once the cocoindex callback surface is exposed. This
      helper's CONTRACT — shape + level + logger — IS the v1 substrate;
      the integration test in 28.14 (audit-log-shipping.integration.test.ts)
      will exercise live emission end-to-end.

    PRODUCT invariants honoured:
      - Inv-13 v1 (structured logs substitute for DEFERRED-v1.1 audit_log).
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
    """Emit one Cloud-Run-parseable structured ERROR log line per stage failure.

    Inv-26 v1 substrate per TECH.md §P-8: every failed pipeline invocation
    emits at least one structured-log line at ERROR level so the failure
    is enumerable from the Cloud Run logging surface (in addition to the
    `pipeline_runs.status='failed'` rollup row).

    Contract shape (6 keys, all required):
      {
        "event":            "cocoindex.stage_error",
        "op_id":            "<uuid string>",
        "stage":            "<stage name>",
        "error_class":      "<one of PIPELINE_ERROR_CLASSES>",
        "content_items_id": "<uuid string>" | null,
        "error_message":    "<truncated, UUID-redacted>",
      }

    PII redaction policy (Inv-26 + ID-28.13 brief):
      - `error_message` is truncated to 200 characters.
      - UUID-shaped substrings inside `error_message` are replaced with
        the placeholder `<uuid>`. Operator forensic correlation is via
        the structured `op_id` / `content_items_id` fields, never the
        message body.

    Args:
      op_id:            cocoindex per-flow op_id (UUID v4); stringified for JSON.
      stage:            Canonical stage name (one of: source_walk,
                        binary_conversion, llm_extraction, embedding,
                        entity_resolution, postgres_upsert).
      error_class:      One of the 6 PIPELINE_ERROR_CLASSES.
      content_items_id: Primary-key row id (UUID) if the failure surfaced
                        post-binding; `None` for pre-binding failures
                        (e.g. Stage 1 source-walk). Serialised as JSON
                        null in the latter case.
      error_message:    Free-form failure message; gets redacted +
                        truncated before emission.

    PRODUCT invariants honoured:
      - Inv-26 (one structured-log line per failed invocation, JSON-parseable).
      - Inv-13 v1 (Cloud Run structured-log substrate is the audit path).
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
    pipeline_name: str = "kh_canonical_pipeline",
) -> None:
    """POST a pipeline-run rollup to the Vercel webhook (Inv-16 / Inv-17 / Inv-18).

    Per TECH.md §P-7 Option α (sidecar webhook callback): the cocoindex
    sidecar emits one HTTP POST per flow lifecycle event (flow start with
    `status='in_progress'`, flow end with one of the three terminal
    statuses). The receiving Vercel route (`POST
    /api/internal/pipeline-runs/record`) delegates to the TS-side
    `recordPipelineRun()` helper — the ONLY path the sidecar uses to land
    `pipeline_runs` rows (Inv-18 code-discipline guard).

    Authentication: `Authorization: Bearer <CRON_SECRET>` (T-OQ2 ratified
    S252 — reuse the existing cron-handler convention; `CRON_SECRET` is
    mounted in the Cloud Run Service env via Secret Manager per ID-28.6).

    Best-effort emission: missing env vars or HTTP errors are LOGGED but
    do NOT raise — the pipeline must keep running even if the rollup
    webhook is unreachable. The structured-log emission via
    `_emit_upsert_log()` remains the per-row audit substrate; webhook
    failure degrades to "log-only" observability rather than crashing the
    flow. Cocoindex's own retry policy (P-OQ2 defaults) governs the data
    plane; the rollup webhook is an out-of-band observability surface.

    Args:
      op_id:             cocoindex per-flow op_id (UUID v4); stringified for JSON.
      status:            'in_progress' (flow start) | 'completed' |
                         'completed_with_errors' | 'failed' (flow end).
      stage_counts:      Per-stage row counts — MUST contain all six canonical
                         stage keys (see `_empty_stage_counts()`); enforced by
                         the Vercel route's Zod schema.
      items_processed:   Total items the pipeline observed in this run.
      items_created:     IDs of `content_items` the pipeline created
                         (empty list on memo-hit no-op runs per Inv-4).
      error_message:     Human-readable failure summary (omit for non-failures).
      error_class:       6-class error vocabulary from 28.13 (omit for non-failures).
      extractor_version: IMAGE_SHA from Cloud Build (28.6) — Inv-8 forensic key.
      pipeline_name:     Defaults to 'kh_canonical_pipeline'.

    Env vars (must be set by Cloud Run Service manifest per ID-28.6):
      PIPELINE_RUN_WEBHOOK_URL — full URL of the Vercel route
                                 (e.g. https://kh.client.example/api/internal/pipeline-runs/record).
      CRON_SECRET              — shared bearer secret with the Vercel route.
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

    # ── ID-28.11 rollup state (Inv-16 / Inv-17) ──────────────────────────────
    # cocoindex 1.0.3 does NOT expose public per-stage completion callbacks
    # (the same API-surface gap surfaced in 28.10 for per-row UPSERT callbacks).
    # Per the brief's escalation rule, the contract is the JSON payload shape,
    # not the per-stage observability source — so the rollup is aggregated via
    # internal counters at flow scope. Per-stage counter-increment wiring is
    # deferred to Subtask 28.13 (alongside per-extraction-kind structured-
    # failure routing). Until then, this Subtask lands the helper contract +
    # flow-start/flow-end invocation substrate.
    run_op_id: uuid.UUID = uuid.uuid4()  # placeholder until cocoindex exposes flow['op_id']
    stage_counts: dict[str, int] = _empty_stage_counts()
    items_created: list[str] = []
    extractor_version = os.environ.get("IMAGE_SHA")

    # Flow start emission (Inv-16: one pipeline_runs row per invocation;
    # in_progress row signals "pipeline accepted work, processing began").
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
            # Per cocoindex-extraction-contract TECH §3.1 (S256 W1 amendment):
            # KH-authored @coco.fn(memo=True) extractors call the anthropic
            # SDK directly + validate via Pydantic TypeAdapter. The flow-scope
            # wiring is a plain `.transform(extractor_fn)`. The extractors are
            # imported from extraction.py (co-located per S256 WP4 architectural
            # choice — see journal block on Subtask 28.12).
            #
            # Memoisation: each extractor is `@coco.fn(memo=True)` keyed on
            # `(content_text,)` per Inv-21 — unchanged content + unchanged
            # prompt → memo hit, zero LLM call.
            #
            # Validation-failure path: Option A — `ValidationError` propagates
            # to app_main()'s `except Exception` block at lines ~582-598 below
            # which sets `flow_error_class = type(exc).__name__` (== "ValidationError")
            # and emits the rollup webhook. Per-extraction-kind structured-
            # failure routing (via `classify_pydantic_error()`) is deferred to
            # Subtask 28.13 alongside the cocoindex-ledger-api TECH §T1.3
            # helper-contract finalisation.
            classification = content_text.transform(extract_classification)  # type: ignore[attr-defined]
            q_a_form = content_text.transform(extract_qa_form)  # type: ignore[attr-defined]
            entity_mentions = content_text.transform(extract_entity_mentions)  # type: ignore[attr-defined]

            # ── stamp_extraction_base() integration — DEFERRED to 28.13 ─────
            # Per Q-EX2 TECH §3.2, after each extractor returns its validated
            # Pydantic object, the `_ExtractionBase` fields (op_id,
            # content_items_id, extracted_at) must be stamped at flow scope:
            #
            #   stamped_classification = stamp_extraction_base(
            #       classification, op_id=<flow-op-id>, content_items_id=<row-pk>
            #   )
            #
            # Cocoindex 1.0.3 does NOT expose `flow["op_id"]` nor
            # `flow["content_items_id"]` as flow-scope symbols (per S254 §P-4
            # discovery; same API-surface gap as Stage 6 bind_target / per-row
            # UPSERT callbacks). The `run_op_id` local var on line ~446 is the
            # v1 Python-scope op_id, but `transform()` consumes a flow column
            # — there is no public 1.0.3 surface to pass a Python-scope local
            # into a `.transform()` call AS a flow input.
            #
            # Per the established 28.8 / 28.9 / 28.10 spec-drift discipline,
            # this Subtask (28.12 WP4) lands:
            #   - The 3 `@coco.fn(memo=True)` extractors (above).
            #   - The `stamp_extraction_base` helper (imported at line ~107).
            #   - The doc-comment substrate documenting the stamping call-site.
            # Real per-row stamping is unblocked by either:
            #   (a) cocoindex 1.0.x exposing `flow["op_id"]` /
            #       `flow["content_items_id"]` symbols at flow scope, OR
            #   (b) KH authoring a flow-scope context-extractor helper that
            #       projects run_op_id + per-row PK into transform inputs.
            # Orchestrator-tracked for 28.13 + TECH §3.2 amendment queue.
            #
            # Until then, classification / q_a_form / entity_mentions carry
            # `Field(...)` placeholder values on the _ExtractionBase fields;
            # the Pydantic shapes themselves enforce that any downstream
            # writer must stamp the fields before persisting to Postgres.

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

            # Flow-scope UPSERT bindings (28.9 — op_id stamping landed).
            # op_id=flow['op_id'] passes the cocoindex per-flow op_id symbol so
            # every UPSERT row carries the originating run's op_id (Inv-11 + Inv-12).
            # flow['op_id'] is assigned at flow-construction time by the engine;
            # identical across all 3 bind_target calls in one flow invocation (Inv-11).
            #
            # API deviation note (S254 / 28.8 + 28.9): bind_target and flow['op_id']
            # are spec-sketch placeholders — cocoindex 1.0.3 does NOT expose a
            # bind_target method on DirWalker/transform chains, nor a flow['op_id']
            # subscript. Real wiring lands when the cocoindex flow-scope op_id API
            # is finalised (28.12 Wave 2 extraction wiring). The type: ignore comments
            # acknowledge this; the kwarg preserves design intent for the Checker.
            content_text.bind_target(  # type: ignore[attr-defined]
                ci_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )
            content_text.bind_target(  # type: ignore[attr-defined]
                qa_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )
            source.bind_target(  # type: ignore[attr-defined]
                sd_target, key_fields=("id",), op_id=flow["op_id"]  # type: ignore[name-defined]
            )

            # ── Inv-13 v1 substrate emission point (P-5) ─────────────────
            # Per TECH.md §P-5, _emit_upsert_log(op_id=flow['op_id'],
            # table=<one of 'content_items' | 'q_a_extractions' |
            # 'source_documents'>, row_id=<pk>, operation=<'INSERT' |
            # 'UPDATE'>) SHOULD fire once per UPSERT, post-commit, at this
            # Stage 6 boundary. The cocoindex 1.0.3 public API does NOT
            # expose a per-row completion callback at mount_table_target /
            # bind_target — UPSERT application is encapsulated inside
            # TableTarget._apply_actions (private). Per the established
            # 28.8 / 28.9 spec-drift discipline, the v1 helper contract
            # (`_emit_upsert_log`) lands here as the callable substrate;
            # real per-row invocation is unblocked by a cocoindex 1.0.x
            # public callback surface (S255 amendment queue → TECH.md §P-5
            # + 28.12 / Wave C carry-forward).
            # See module docstring "API deviation note (S255 / 28.10)".
    except Exception as exc:  # noqa: BLE001 — capture for rollup status
        # Per Inv-16 + Inv-17 + Inv-18: failures still land a pipeline_runs
        # row via the webhook so the cocoindex sidecar's invocation count
        # is honest (one row per invocation, success or fail).
        #
        # Classification (ID-28.13): map the exception to one of the 6
        # canonical stage-level classes per PRODUCT Inv-25 via
        # `_classify_stage_exception()`. Unmapped exceptions fall back to
        # the Python type name so `pipeline_runs.error_class` is never
        # NULL on a `status='failed'` row — but the Vercel route's Zod
        # validator will reject any unmapped class string with HTTP 400,
        # which surfaces drift (a new exception type that bypassed the
        # classifier) as an operator-visible 4xx rather than a silent
        # data-quality regression. The fallback flag is wrapped in a
        # `coco.stage_error.unclassified` log line so the drift is
        # forensically traceable.
        flow_status = "failed"
        flow_error_message = str(exc)
        classified = _classify_stage_exception(exc)
        if classified is not None:
            flow_error_class = classified
        else:
            # Fallback: emit a marker log so operators see "unclassified
            # exception type X reached the rollup boundary" and can amend
            # the classifier. The webhook still gets the type-name value
            # so the failure row lands — the Zod validator at the trust
            # boundary will reject it with HTTP 400 if the class name is
            # not in the 6-class enum, which is the desired loud-fail
            # behaviour for drift detection.
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

        # Per-stage structured error log emission (Inv-26). The stage
        # name is "flow" at this level — the granular per-stage handlers
        # remain stubs until cocoindex 1.0.x exposes per-stage completion
        # callbacks (same blocker as 28.10 / 28.11 / 28.12 stamping).
        # Until then, the flow-scope `except` block is the single
        # structured-log emission point; finer-grained per-stage logs
        # land when the public callback surface is available.
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
        # Flow end emission (Inv-16: terminal pipeline_runs row).
        # stage_counts is filled at the placeholder zero values until 28.13
        # wires per-stage counter increments (see escalation note at the
        # rollup-state block above). items_created is similarly empty at
        # v1 — populated when 28.13's per-extraction-kind write path lands.
        await _emit_pipeline_run_webhook(
            op_id=run_op_id,
            status=flow_status,
            stage_counts=stage_counts,
            items_processed=sum(stage_counts.values()) or 0,
            items_created=items_created,
            error_message=flow_error_message,
            error_class=flow_error_class,
            extractor_version=extractor_version,
        )


# ── Module-level App declaration ─────────────────────────────────────────────
# coco.App(config, main_fn) registers the pipeline with the cocoindex environment.
# Used by __main__.py entry point and Cloud Run Service GOOGLE_ENTRYPOINT.
#
# API deviation from TECH.md sketch (S254 / 28.8 discovery):
#   TECH.md shows: KH_PIPELINE_APP = coco.AppConfig(name='kh_pipeline', main_fn=app_main)
#   Actual 1.0.3:  coco.AppConfig has NO main_fn field — main_fn goes to coco.App.
#   Correct form:  KH_PIPELINE_APP = coco.App(coco.AppConfig(name='kh_pipeline'), app_main)
#   This deviation is noted for Checker review; 28.9 brief should reflect corrected form.

KH_PIPELINE_APP = coco.App(
    coco.AppConfig(name="kh_pipeline"),
    app_main,
)


if __name__ == "__main__":
    asyncio.run(coco.start())
