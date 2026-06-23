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
  docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-2, §P-5, §P-7, §P-8
  docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-23..Inv-27
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import aiohttp
import asyncpg
import charset_normalizer  # robust bytes→str decode for fetched HTML (ID-112.7)
import cocoindex as coco
import httpx

# Off-surface cocoindex symbols resolve through the {67.4} insulation façade
# (`_coco_api`) so a version bump is a one-file fix. These are eager top-level
# re-exports of connectors / connectorkits sub-package symbols — they do NOT
# touch the `cocoindex.ops` subtree, so collection-safety for the bare-MagicMock
# unit tests is preserved. The `ops.*` symbols (LiteLLMEmbedder, RecursiveSplitter)
# stay function-local below for that reason.
from scripts.cocoindex_pipeline._coco_api import (
    ColumnDef,
    ManagedBy,
    TableSchema,
    localfs,
    mount_table_target,
)
from scripts.cocoindex_pipeline.adapters import (
    _PULLMD_X_SOURCE_METHODS,  # CHECK-enum-safe X-Source mapping (75.10 step 2)
    _docling_to_markdown,  # PDF-route inner tier for URL items (75.10 / D-12)
    _pullmd_fetch,  # epoch-keyed PullMD fetch (75.9 / D-4)
    convert_binary_to_markdown,  # P-3 outer-tier adapter (28.7 — LANDED)
    extract_source_provenance,  # Stage-6 pullmd provenance fan-out (42.9 §WP-E)
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
from scripts.cocoindex_pipeline.canonicalisation import (
    canonicalise_entity_name,
    canonicalise_for_relationship,
    prime_alias_cache_from_db_rows,
)
from scripts.cocoindex_pipeline.entity_context import extract_entity_context
# ID-112.7 — the worker HTML branch cleans fetched HTML IN-PROCESS via the
# single shared Trafilatura cleaner ({112.5}), replacing the retired PullMD
# fetch+extract hop (PI-1). NO HTTP hop to POST /extract — the worker IS the
# caller (TECH §B2 topology); it owns the fetch behind the step-1 `validate_url`
# SSRF gate (PI-3 — the cleaner itself is a pure HTML→text function, no fetch).
from scripts.cocoindex_pipeline.extract import (
    GateVerdict,
    apply_quality_gate,
    clean_html,
)
from scripts.cocoindex_pipeline.extraction import (
    TruncatedExtractionError,
    classify_pydantic_error,
    extract_classification,
    extract_entity_mentions,
    extract_qa_form,
    extract_relationships,
    stamp_extraction_base,
)
from scripts.cocoindex_pipeline.holder_rule import (
    CLIENT_ORG_ENV_VAR,
    derive_holder_metadata,
)

# Production LLM model tier per cocoindex-extraction-contract TECH §3.1.
# Single source of truth lives in extraction.py (ID-44.3 dedup); re-exported
# here so `flow.ANTHROPIC_MODEL` resolves for the idle-mode test pin and any
# flow-scope consumer. Not referenced in flow.py's body — hence the F401
# suppression (matches the re-export convention in __main__.py / server.py).
#
# Post-{67.2} the pipeline is canonicalised onto the single
# `scripts.cocoindex_pipeline.*` namespace, so this uses the absolute import
# form like its siblings below (the prior relative-import namespace-tolerance
# rationale is now moot). One module copy guarantees
# `flow.ANTHROPIC_MODEL is extraction.ANTHROPIC_MODEL`.
from scripts.cocoindex_pipeline.extraction import ANTHROPIC_MODEL  # noqa: F401 — re-export, single source of truth
from scripts.cocoindex_pipeline.flow_context import (
    FLOW_META_CTX,  # noqa: F401 — re-exported flow-context surface (28.13 wiring + tests)
    FlowRunMeta,
    bind_flow_meta,
    bind_retry_counter,
    bind_stage_counter,
    bind_taxonomy_miss_counter,
    bind_workspace_manifest,
    current_flow_meta,  # noqa: F401 — re-export; ingest_file resolves it lazily
)

# ID-52 Path B (form extraction). The orchestrator + per-format readers run as
# plain awaits inside `ingest_file`'s form-write block; the workspace resolver
# maps each ingested file's rel_path to a workspace via the flow-start manifest.
# `current_workspace_manifest` is resolved inside `ingest_file` via the
# function-local `from scripts.cocoindex_pipeline import flow_context` import
# (same pattern as `current_flow_meta`), so it is NOT imported by name here.
from scripts.cocoindex_pipeline.form_extractors import extract_form_structure
from scripts.cocoindex_pipeline.form_extractors.orchestrator import (
    coerce_extracted_form,
)
from scripts.cocoindex_pipeline.form_extractors.shared import FormExtractionError

# ID-75 WP-C — URL-source substrate ({75.7}/{75.8} leaf modules). `UrlItem` is
# the frozen memo-keyed component argument (EXECUTOR-VERIFY-1); `validate_url`
# is the verbatim SSRF port gating every fetch (BI-21). `FeedUrlSource` is the
# passed-ledger snapshot source `app_main` mounts at {75.11} (D-1/D-2).
from scripts.cocoindex_pipeline.url_source import FeedUrlSource, UrlItem
from scripts.cocoindex_pipeline.url_validation import validate_url
from scripts.cocoindex_pipeline.workspace_resolver import (
    ManifestLoadError,
    Resolution,
    ResolutionFailure,
    UnmappedPath,
    load_workspace_manifest,
    resolve_route,
)

# ID-53 §P-1 (Inv-1). Stage-5 entity-resolution flow-scope post-pass. Imported
# at module top (NOT lazily) — stage_5.py imports the flow-side types under
# TYPE_CHECKING only, so there is no runtime import cycle.
from scripts.cocoindex_pipeline.stage_5 import _run_stage_5_resolution

# ID-120 §P-3 (INV-1). Cross-workspace + cross-form Q&A dedup PROPOSER post-pass.
# Imported at module top alongside Stage-5 — qa_dedup_proposer.py imports the
# flow-side type (`_FlowStageCounter`) under TYPE_CHECKING only, so there is no
# runtime import cycle.
from scripts.cocoindex_pipeline.qa_dedup_proposer import _run_qa_dedup_proposer
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

# Pydantic v2 ValidationError messages echo the offending value verbatim via
# `input_value=…` (e.g. `[type=missing, input_value='ACME Bid', input_type=str]`).
# On extraction-validation failures that value is LLM-extracted CLIENT content —
# the dominant PII leak vector (UUID redaction + truncation alone leave a short
# client name/phrase exposed). Matched non-greedily up to the next `, input_type=`
# or closing `]`; DOTALL so multi-line echoed values are still captured.
# See bl-165 / Option D.
_INPUT_VALUE_RE = re.compile(r"input_value=.+?(?=, input_type=|\])", re.DOTALL)


class _EntityResolutionStageError(Exception):
    """Wraps any exception escaping the Stage-5 resolution post-pass so the
    stage-level classifier can attribute it to ``entity_resolution_failed``
    regardless of the underlying provider exception type (ID-53.15, T-OQ1).

    The {53.14} failure-injection finding established that Stage-5 failures
    surface as provider auth errors that are TYPE-INDISTINGUISHABLE from a
    Stage-3 extraction failure:

      - embedder failMode → ``litellm.exceptions.AuthenticationError``
        (``__module__`` is ``litellm.exceptions``, NOT ``entity_embedder``).
      - pair_resolver failMode → ``anthropic.AuthenticationError``, an
        ``anthropic.APIError`` subclass (``__module__`` is ``anthropic``,
        NOT ``pair_resolver``).

    Because the real exception modules are ``anthropic`` / ``litellm`` —
    NOT the resolver/embedder modules — matching on ``type(exc).__module__``
    prefix cannot catch them. Classification therefore requires STAGE
    CONTEXT, supplied by re-raising any Stage-5 escape as this wrapper at
    the ``_run_stage_5_resolution`` attach site (preserving ``__cause__``
    via ``raise … from exc``). ``_classify_stage_exception`` then resolves
    this wrapper ahead of the generic ``anthropic.APIError`` branch.
    """


class _QaDedupProposerStageError(Exception):
    """Wraps any exception escaping the ID-120 Q&A dedup proposer post-pass so
    the stage-level classifier can attribute it to ``qa_dedup_proposer_failed``
    (TECH §P-3, INV-1) regardless of the underlying exception type.

    Mirrors ``_EntityResolutionStageError``: the proposer attach site re-raises
    any escape as this wrapper (``raise … from exc`` preserves ``__cause__``),
    and ``_classify_stage_exception`` resolves it to the contained stage code.
    The proposer is a CONTAINED post-pass — a proposer failure classifies the
    run but the walk's primary ingest already landed; the failure is surfaced on
    the pipeline-runs row, not allowed to mask a successful ingest as a different
    stage's failure.
    """


def _classify_stage_exception(exc: BaseException) -> str | None:
    """Map a Python exception to the Inv-25 6-class stage-level vocabulary.

    Returns the canonical class string when the exception type matches a
    known stage-failure pattern, or `None` when the exception is unmapped
    (the caller is then free to fall back to the exception class name or
    treat it as an internal failure).

    Mappings (per TECH.md §P-8 + the ID-28.13 dispatch brief):

      - `_EntityResolutionStageError`     → `entity_resolution_failed`
      - `cocoindex.ops.entity_resolution.*` → `entity_resolution_failed`
      - `pydantic.ValidationError`        → `extraction_validation_failed`
      - `anthropic.APIStatusError`        → `extraction_provider_unavailable`
      - `anthropic.APIConnectionError`    → `extraction_provider_unavailable`
      - `anthropic.APIError` (other)      → `extraction_provider_unavailable`
      - `asyncpg.PostgresError`           → `postgres_write_failed`
      - `docling.*` (any docling-raised)  → `binary_conversion_failed`

    Entity-resolution-stage failures ARE auto-classified per ID-53.15
    (T-OQ1 ratified Option (a), S275+). They are caught by STAGE CONTEXT,
    not exception type: the Stage-5 attach site re-raises any escape as
    `_EntityResolutionStageError`, which this mapper resolves to
    `entity_resolution_failed` BEFORE the generic `anthropic.APIError`
    branch. The ordering is load-bearing — a Stage-5-wrapped
    `anthropic.AuthenticationError` (pair_resolver failMode) is otherwise
    type-indistinguishable from a Stage-3 extraction provider failure, so
    without the wrap-branch-first ordering it would misclassify as
    `extraction_provider_unavailable`. A BARE (unwrapped) anthropic error
    still falls through to the generic provider branch — Stage-3 semantics
    preserved. The belt-and-suspenders `cocoindex.ops.entity_resolution.*`
    module-prefix branch catches any DIRECT typed error from the resolution
    op that could arise before the LLM call. We deliberately do NOT match
    on `pair_resolver` / `entity_embedder` module prefixes: the {53.14}
    failure-injection finding showed the real exceptions are
    `anthropic` / `litellm` typed, so those prefixes would be dead code.

    Embedding-stage classes (`embedding_failed`) remain NOT auto-classified
    at v1: their upstream LiteLLM exception types are not yet wired as a
    distinct stage surface in flow.py. Once Stage-4 grows a dedicated
    failure surface, this mapper grows one more branch.

    Args:
      exc: The exception instance to classify.

    Returns:
      One of the 6 canonical class strings, or `None` for unmapped types.
    """
    # Stage-5 entity-resolution failure (ID-53.15, T-OQ1). MUST precede the
    # anthropic.APIError branch below: a Stage-5-wrapped
    # anthropic.AuthenticationError (pair_resolver failMode) is otherwise
    # type-indistinguishable from a Stage-3 extraction provider failure. The
    # wrap is applied at the `_run_stage_5_resolution` attach site so stage
    # context — not exception type — drives the classification.
    if isinstance(exc, _EntityResolutionStageError):
        return "entity_resolution_failed"

    # ID-120 §P-3 (INV-1): Q&A dedup proposer failure. CONTAINED — the proposer
    # attach site catches its own re-wrapped escape so the walk is NOT aborted
    # (the primary ingest already landed); this branch classifies the proposer
    # failure for the structured stage-error log + pipeline-runs row. Placed
    # before the generic provider branches for the same stage-context-over-type
    # reason as the Stage-5 branch above.
    if isinstance(exc, _QaDedupProposerStageError):
        return "qa_dedup_proposer_failed"

    # Belt-and-suspenders: a DIRECT typed error raised from the entity
    # resolution op module (e.g. a preload-step failure before the LLM call).
    # NOT a pair_resolver / entity_embedder prefix — the {53.14} finding
    # showed the real provider exceptions are anthropic/litellm typed.
    _exc_module_early = type(exc).__module__ or ""
    if _exc_module_early.startswith("cocoindex.ops.entity_resolution"):
        return "entity_resolution_failed"

    # Truncated extraction (Stage 3 LLM-extraction failure surface — bl-220
    # continuation §31). A `max_tokens` cutoff yields an incomplete JSON body the
    # extractor cannot validate; it is the SAME Stage-3 "the LLM output is
    # unusable" family as a pydantic `ValidationError`, so it maps to the same
    # canonical class `extraction_validation_failed`. The check is SPECIFIC to
    # `TruncatedExtractionError` (a `ValueError` subclass) — a BARE `ValueError`
    # still falls through to `None` (it is NOT a stage-classified failure), so the
    # `_classify_stage_exception(ValueError(...)) is None` contract is preserved.
    # Without this branch a truncated extraction logged
    # `cocoindex.stage_error.unclassified` instead of a classified stage error.
    if isinstance(exc, TruncatedExtractionError):
        return "extraction_validation_failed"

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


def _pydantic_error_detail(exc: BaseException) -> dict[str, str] | None:
    """Build the fine-grained Pydantic error detail for the run record.

    bl-165 Option B (ID-61.4): when a `pydantic.ValidationError` aborts the
    flow, the coarse Inv-25 class (`extraction_validation_failed`, via
    `_classify_stage_exception`) is too blunt for ledger triage. This helper
    additionally maps the exception through `classify_pydantic_error()`
    (extraction.py — single source of truth for the fine vocabulary:
    missing_required / invalid_enum / invalid_discriminator /
    unexpected_field / type_coercion) so the terminal webhook can carry

      errorDetail = {"pydantic_class": <fine class>, "stage": "flow"}

    which the Vercel route persists into `pipeline_runs.result.error_detail`
    ALONGSIDE the unchanged coarse `result.error_class`.

    PII (Option-D preservation): the detail deliberately carries NO message
    text — only the fine class + stage — so there is no surface for pydantic
    `input_value=` echoes or UUIDs to leak through. `_redact_error_message`
    continues to guard the one message surface (`flow_error_message`).

    Args:
      exc: The captured flow-scope exception.

    Returns:
      The two-key detail dict for a `ValidationError`, or `None` for any
      other exception type (the webhook then omits the field entirely).
    """
    try:
        from pydantic import ValidationError as _PydanticValidationError
    except ImportError:  # pragma: no cover — pydantic is required at runtime
        return None
    if not isinstance(exc, _PydanticValidationError):
        return None
    return {"pydantic_class": classify_pydantic_error(exc), "stage": "flow"}


def _redact_error_message(msg: str, *, max_length: int = 200) -> str:
    """Apply PII redaction to a stage-error message for structured logging.

    Three steps (per Inv-26 + ID-28.13 brief; input_value strip per bl-165 / Option D):
      1. Strip pydantic `input_value=…` echoes — on extraction
         ValidationErrors these carry LLM-extracted client content verbatim
         (the dominant PII vector). Replaced with `input_value=<redacted>`.
      2. Replace UUID-shaped substrings with the placeholder `<uuid>` so
         per-row identifiers don't leak through error messages — operator
         forensic correlation is via the structured-log `op_id` /
         `content_items_id` fields, not the message body.
      3. Truncate to `max_length` (default 200) characters so provider
         5xx responses that echo user-supplied payloads cannot bloat the
         log surface.

    Args:
      msg:        The raw error message (typically `str(exc)`).
      max_length: Maximum length of the redacted message (default 200).

    Returns:
      The redacted, truncated message safe for structured-log emission.
    """
    redacted = _INPUT_VALUE_RE.sub("input_value=<redacted>", msg)
    redacted = _UUID_RE.sub("<uuid>", redacted)
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


def _emit_workspace_unmapped_warn(
    *,
    op_id: uuid.UUID | str,
    content_items_id: uuid.UUID | str | None,
    error_message: str,
) -> None:
    """Emit ONE benign WARNING-level structured log for an unmapped path.

    bl-219: an unmapped content path (no manifest prefix matches) is
    OBSERVABILITY-ONLY for localfs file content — the workspace-agnostic
    canonical layer (content_items / source_documents / chunks / q_a /
    entity_mentions) already wrote ABOVE the form-resolution block
    (ID-69 BI-1), and the pipeline invocation does NOT fail. It is therefore
    NOT a `cocoindex.stage_error`: per Inv-26 that event is the companion to
    a *failed* invocation, so emitting it for a benign unmapped path is a
    false-alarm contract smell. The ambiguous case stays a loud stage error
    (`_emit_stage_error_log`) because it is a genuine manifest mis-wire.

    Contract shape (WARNING level):

      {"event": "workspace_resolution.unmapped", "op_id": "<uuid>",
       "content_items_id": "<uuid>"|null,
       "reason": "<truncated to 200 chars, UUIDs redacted>"}

    Reuses `_redact_error_message` for the same PII redaction as the error
    emitter. Returns None; raises nothing.
    """
    payload: dict[str, object | None] = {
        "event": "workspace_resolution.unmapped",
        "op_id": str(op_id),
        "content_items_id": (
            str(content_items_id) if content_items_id is not None else None
        ),
        "reason": _redact_error_message(error_message),
    }
    _logger.warning(json.dumps(payload))


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

    At v1 the wired stages are `"embedding"` (Inv-17 gap closure inherited from
    ID-49.2), `"entity_resolution"` (Inv-11 Stage-5 elevation, ID-53.14), and
    `"chunking"` (Inv-11 elevation, ID-56.8 — bumped once per declared
    content_chunks row). Keys are the canonical stage names from
    `_empty_stage_counts()`; an unbumped stage reads back as 0.
    """

    def __init__(self) -> None:
        self._counts: dict[str, int] = {}

    def increment(self, stage: str) -> None:
        self._counts[stage] = self._counts.get(stage, 0) + 1

    def get(self, stage: str) -> int:
        return self._counts.get(stage, 0)


# ── Inv-7 taxonomy-miss substrate (ID-63.8 — out-of-taxonomy soft-warn) ──────


class _FlowTaxonomyMissCounter:
    """Per-flow out-of-taxonomy-miss counter for Inv-7 observability.

    `.record(field=..., value=...)` is called from the
    `_surface_out_of_taxonomy_classification` model-validator on
    `ClassificationExtraction` (extraction.py) via the
    `bind_taxonomy_miss_counter()` contextvar binding `app_main` wraps
    `mount_each` in, each time the LLM proposes a `primary_domain` /
    `primary_subtopic` / `secondary_classification` value outside the
    canonical taxonomy snapshot. The ROW IS STILL WRITTEN UNCHANGED — this
    counter is observability-only (soft-warn, never reject). `.tally_by_field()`
    is read at flow end and folded into the pipeline-run webhook payload,
    broken down by field.

    Instances are per-flow — one per `app_main()` invocation, no shared state.
    Thread-safety is not required: cocoindex @coco.fn execution is sequential
    per content row. Mirrors `_FlowRetryCounter` / `_FlowStageCounter`.
    """

    def __init__(self) -> None:
        self._counts: dict[tuple[str, str], int] = {}

    def record(self, *, field: str, value: str) -> None:
        key = (field, value)
        self._counts[key] = self._counts.get(key, 0) + 1

    def get(self, *, field: str, value: str) -> int:
        return self._counts.get((field, value), 0)

    def tally_by_field(self) -> dict[str, int]:
        tally: dict[str, int] = {}
        for (field, _value), count in self._counts.items():
            tally[field] = tally.get(field, 0) + count
        return tally


# ── 80.2 §B.4 per-item-failure substrate (ID-80.9 — OQ-80.2-C RATIFIED) ─────


class _FlowItemFailureCounter:
    """Per-flow per-branch item-failure tally for 80.2 §B.4 observability.

    `.increment(branch)` is called from the per-item containment handlers in
    `app_main` — `bound_ingest_file` (`branch` is `'forms'` or `'content'`,
    derived via `_item_failure_branch` from the same pure `resolve_route`
    computation the {80.8} fork uses) and `bound_ingest_url` (`branch` is
    always `'url'`, {75.11} / BI-19) — each time an UNEXPECTED exception
    escapes one item's ingest. `.tally()` is read at flow end and emitted via
    the pipeline-run webhook as `itemFailures`
    (`{'forms': n, 'content': m, 'url': k}`).

    OQ-80.2-C (Liam, S314, 05/06/2026): per-item faults leave
    `flow_status='completed'` and ride this tally; `'failed'` is reserved for
    walk-wide faults (manifest load, Stage-5, mount errors). This is the
    bl-224 cascade inversion — one form file's fault must never zero a
    content file's reported writes.

    Instances are per-flow — one per `app_main()` invocation, no shared
    state. Thread-safety is not required: cocoindex @coco.fn execution is
    sequential per content row. Mirrors `_FlowRetryCounter` /
    `_FlowStageCounter`.
    """

    def __init__(self) -> None:
        # 'url' joined the branch vocabulary at {75.11} (the URL-source mount)
        # — initialised to 0 so an all-zero tally reports every branch ("walk
        # ran, zero per-item faults" is meaningful per branch, 80.2 §B.4).
        self._counts: dict[str, int] = {"forms": 0, "content": 0, "url": 0}

    def increment(self, branch: str) -> None:
        self._counts[branch] = self._counts.get(branch, 0) + 1

    def tally(self) -> dict[str, int]:
        return dict(self._counts)


def _item_failure_branch(manifest: Any, file: Any, source_path: Any) -> str:
    """Attribute a contained per-item fault to its `'forms'`/`'content'` branch.

    Uses the SAME pure `resolve_route(manifest, rel_path)` computation the
    {80.8} route fork uses (80.2 §B.2: input-only, no I/O, no clock), with the
    same `_to_source_relative` normalisation the dispatcher applies
    ({66.22}/BUG-A — production File paths are absolute).

    NEVER raises: this helper runs inside the per-item containment handler
    (80.2 §B.4), where an escape would abort the batch — the exact
    all-or-nothing failure mode the containment exists to kill. Any
    derivation failure (unmapped path, ambiguous manifest, malformed item)
    defaults the attribution to `'content'` (the manifest's own `route`
    default per 80.2 §B.2).
    """
    try:
        rel_path = _to_source_relative(file.file_path.path, source_path)
        route = resolve_route(manifest, rel_path).route
    except Exception:  # noqa: BLE001 — containment handler must never raise
        return "content"
    return "forms" if route == "forms" else "content"


# ── Inv-16 / Inv-17 / Inv-18 rollup substrate (P-7 — ID-28.11) ───────────────


PipelineRunStatus = Literal[
    "in_progress",
    "completed",
    "completed_with_errors",
    "failed",
]

# Canonical name the sidecar stamps on every `pipeline_runs.pipeline_name`
# emission (Inv-16). Centralised here (ID-55.3) as the single producer-side
# source of truth so the literal is not duplicated across the flow default arg
# and the cocoindex integration tests — preventing silent divergence if the
# pipeline is ever renamed. The TS integration suite mirrors this via
# `KH_CANONICAL_PIPELINE_NAME` in `__tests__/integration/cocoindex/test-helpers.ts`.
KH_CANONICAL_PIPELINE_NAME = "kh_canonical_pipeline"


def _empty_stage_counts() -> dict[str, int]:
    """Return the canonical seven-stage counter map initialised to zero.

    The stages mirror the canonical pipeline topology per `02-data-flow.md`
    §3.1, extended by the ID-56.8 `"chunking"` stage (the cocoindex
    RecursiveSplitter chunk-row writer). The webhook route (`POST
    /api/internal/pipeline-runs/record`) enforces ALL seven keys via Zod, so
    every emission MUST supply the full map (even zeros).
    """
    return {
        "source_walk": 0,
        "binary_conversion": 0,
        "llm_extraction": 0,
        "embedding": 0,
        "entity_resolution": 0,
        "chunking": 0,
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
    error_detail: dict[str, str] | None = None,
    extractor_version: str | None = None,
    retry_count: int | None = None,
    taxonomy_misses: dict[str, int] | None = None,
    item_failures: dict[str, int] | None = None,
    pipeline_name: str = KH_CANONICAL_PIPELINE_NAME,
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
    # bl-165 Option B (ID-61.4): fine Pydantic detail rides ALONGSIDE the
    # coarse errorClass — `None` omits the field entirely so the Vercel
    # route composes `result` without an `error_detail` key.
    if error_detail is not None:
        payload["errorDetail"] = error_detail
    if extractor_version is not None:
        payload["extractorVersion"] = extractor_version
    # `retry_count=0` is meaningful (no-retry happy path) — use `is not None`
    # so 0 lands verbatim, mirroring the route's `!== undefined` check.
    if retry_count is not None:
        payload["retryCount"] = retry_count
    # ID-63.8 Inv-7: per-field tally of out-of-taxonomy soft-warns. `None`
    # omits the field entirely (flow-start emission, where no extraction has
    # run yet); an empty dict at flow-end means "extractions ran, zero misses".
    if taxonomy_misses is not None:
        payload["taxonomyMisses"] = taxonomy_misses
    # ID-80.9 (80.2 §B.4, OQ-80.2-C): per-branch tally of CONTAINED per-item
    # faults — `{'forms': n, 'content': m}`. `None` omits the field entirely
    # (flow-start emission); the terminal emission always threads the tally,
    # so an all-zero map at flow end means "walk ran, zero per-item faults".
    # Rides ALONGSIDE errorDetail/taxonomyMisses (ID-61.4) — never clobbers.
    if item_failures is not None:
        payload["itemFailures"] = item_failures

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

# bl-223: `text-embedding-3-large` has a HARD input ceiling of 8192 tokens —
# OpenAI's API limit, NOT our config. A real ITT form's `content_text` easily
# exceeds it; feeding the full body to `.embed()` raises
# `openai.BadRequestError 400: "maximum input length is 8192 tokens"`, which
# cocoindex surfaces as "component build failed" and aborts the WHOLE document
# ingest → zero rows persist (caught in the S301 live re-smoke). We bound only
# the EMBEDDING INPUT to a budget BELOW the cap (the 400 is exact at 8192, so
# 8000 leaves headroom). The stored `content_items.content` is unaffected — the
# caller still writes `content_text` in full and chunks from it; truncation here
# yields a coarse lead-token document vector (per-chunk retrieval is separate).
EMBEDDING_INPUT_TOKEN_BUDGET = 8000
# `text-embedding-3-large` tokenises with the `cl100k_base` BPE (the same
# encoding litellm uses for its own token accounting). tiktoken ships it; it is
# a litellm transitive dep, pinned explicitly in requirements.txt because this
# truncation guard now treats it as a first-class production dependency.
EMBEDDING_TOKENIZER_ENCODING = "cl100k_base"
# Conservative fallback when tiktoken is somehow unavailable: ~3.5 chars/token
# for English prose ⇒ a char budget that stays comfortably under 8192 tokens.
_EMBEDDING_FALLBACK_CHARS_PER_TOKEN = 3.5

# Lazily-built, process-wide tiktoken encoder for the embedding tokenizer.
# `None` means "not yet attempted"; a sentinel string distinguishes "attempted
# and unavailable" so we only emit the fallback warning once.
_EMBEDDING_ENCODER: object | None = None
_EMBEDDING_ENCODER_UNAVAILABLE = "tiktoken-unavailable"


def _get_embedding_encoder() -> object | None:
    """Return the `cl100k_base` tiktoken encoder, or None if tiktoken is absent.

    Memoised on the module. Returning None routes `_truncate_embedding_input`
    onto its conservative character-budget fallback (bl-223) rather than raising
    — a missing optional tokenizer must never break ingest.
    """
    global _EMBEDDING_ENCODER
    if _EMBEDDING_ENCODER is None:
        try:
            import tiktoken  # noqa: PLC0415

            _EMBEDDING_ENCODER = tiktoken.get_encoding(EMBEDDING_TOKENIZER_ENCODING)
        except Exception:  # noqa: BLE001 — any import/lookup failure ⇒ char fallback
            _EMBEDDING_ENCODER = _EMBEDDING_ENCODER_UNAVAILABLE
    if _EMBEDDING_ENCODER == _EMBEDDING_ENCODER_UNAVAILABLE:
        return None
    return _EMBEDDING_ENCODER


def _truncate_embedding_input(content_text: str) -> str:
    """Bound `content_text` to ≤ EMBEDDING_INPUT_TOKEN_BUDGET tokens for `.embed()`.

    Token-accurate via tiktoken (`cl100k_base`) when available; otherwise a
    conservative character-budget fallback. Returns the text unchanged when it is
    already within budget (no log). On truncation, emits a single structured
    soft-warn (`cocoindex.embedding.input_truncated`) mirroring the
    `_emit_upsert_log` / `_emit_stage_error_log` JSON-logging style, then returns
    the truncated lead slice. This bounds ONLY the embedding input — the caller's
    `content_text` (stored as `content_items.content`, and the chunking source)
    is never mutated. bl-223.
    """
    encoder = _get_embedding_encoder()
    if encoder is not None:
        token_ids = encoder.encode(content_text)
        if len(token_ids) <= EMBEDDING_INPUT_TOKEN_BUDGET:
            return content_text
        truncated = encoder.decode(token_ids[:EMBEDDING_INPUT_TOKEN_BUDGET])
        _logger.warning(
            json.dumps(
                {
                    "event": "cocoindex.embedding.input_truncated",
                    "model": EMBEDDING_MODEL,
                    "tokenizer": EMBEDDING_TOKENIZER_ENCODING,
                    "from_tokens": len(token_ids),
                    "to_tokens": EMBEDDING_INPUT_TOKEN_BUDGET,
                    "from_chars": len(content_text),
                    "to_chars": len(truncated),
                }
            )
        )
        return truncated

    # tiktoken unavailable — conservative character-budget fallback. Token-exact
    # truncation needs tiktoken; this floor only guarantees we stay under the
    # 8192-token 400 ceiling, it does not target EMBEDDING_INPUT_TOKEN_BUDGET.
    char_budget = int(EMBEDDING_INPUT_TOKEN_BUDGET * _EMBEDDING_FALLBACK_CHARS_PER_TOKEN)
    if len(content_text) <= char_budget:
        return content_text
    truncated = content_text[:char_budget]
    _logger.warning(
        json.dumps(
            {
                "event": "cocoindex.embedding.input_truncated",
                "model": EMBEDDING_MODEL,
                "tokenizer": "char-fallback",
                "from_chars": len(content_text),
                "to_chars": len(truncated),
                "note": (
                    "tiktoken unavailable — used char budget; install tiktoken "
                    "for token-accurate truncation"
                ),
            }
        )
    )
    return truncated


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
# function-local `from scripts.cocoindex_pipeline import flow_context` lazy
# import used elsewhere in this file.
_EMBEDDER: object | None = None


def _get_embedder() -> object:
    """Return the process-wide LiteLLMEmbedder, instantiating on first use."""
    global _EMBEDDER
    if _EMBEDDER is None:
        from scripts.cocoindex_pipeline._coco_api import (  # noqa: PLC0415
            LiteLLMEmbedder,
        )

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

    bl-223: the embedding INPUT is bounded to EMBEDDING_INPUT_TOKEN_BUDGET tokens
    (below `text-embedding-3-large`'s hard 8192-token API ceiling) before the
    `.embed()` call, so a large document body cannot trigger an
    `openai.BadRequestError 400` that aborts the whole ingest. Only the embedded
    input is truncated — the caller's full `content_text` is stored / chunked
    unchanged. The truncation is a no-op (and silent) for under-budget text.
    """
    embed_input = _truncate_embedding_input(content_text)
    vector = await _get_embedder().embed(embed_input)
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
        # ID-64.10 (S296): the canonical body column in prod is `content` (NOT
        # NULL), NOT `content_text` — the pipeline was coded against an assumed
        # schema; the live UndefinedColumnError surfaced once extraction reached
        # the write. Rename only — the value is the Stage-2 markdown body.
        "content": ColumnDef(type="text", nullable=False),
        # ID-64.10 (S296): title + content_type are NOT NULL in prod and were
        # never written. title = classifier suggested_title ?? filename-stem;
        # content_type = the taxonomy-validated classifier value (both written
        # in ci_target.declare_row below).
        "title": ColumnDef(type="text", nullable=False),
        "content_type": ColumnDef(type="text", nullable=False),
        "embedding": ColumnDef(
            type="vector(1024)",
            nullable=True,
            encoder=_encode_pgvector,
        ),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
        "source_document_id": ColumnDef(type="uuid", nullable=True),
        # ID-63.7 (OQ-63-9): persist the classifier's domain + subtopic. The
        # live content_items columns already exist nullable (database.types.ts
        # content_items Row) — NO migration here; the NOT-NULL + 'unclassified'
        # sentinel tightening is the separate {63.11} migration.
        "primary_domain": ColumnDef(type="text", nullable=True),
        "primary_subtopic": ColumnDef(type="text", nullable=True),
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
        # ID-54.1 (S273 OQ-52-LOSSY): the 4 QAPair form-question fields the LLM
        # extractor emits were previously dropped at write time. text[] arrays
        # map Python list[str] via asyncpg (precedent: reference_urls below).
        "expected_response_kind": ColumnDef(type="text", nullable=True),
        "evaluation_criteria": ColumnDef(type="text", nullable=True),
        "evidence_requirements": ColumnDef(type="text[]", nullable=False),
        "scope_tags": ColumnDef(type="text[]", nullable=False),
        # ID-94.1 (G4): 3-5 alternate question phrasings captured at ingest
        # (migration 20260608210723). text[] NOT NULL DEFAULT '{}' — mirrors the
        # evidence_requirements/scope_tags precedent; asyncpg maps list[str].
        "alternate_question_phrasings": ColumnDef(type="text[]", nullable=False),
        "extraction_metadata": ColumnDef(type="jsonb", nullable=False),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
    },
    primary_key=("id",),
)

SOURCE_DOCUMENTS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "storage_path": ColumnDef(type="text", nullable=False),
        # ID-64.10/64.11 (S296): prod column is `content_hash` (NOT NULL), NOT
        # `content_fingerprint` (absent in prod). Rename only — value is the
        # awaited file content-hash hex.
        "content_hash": ColumnDef(type="text", nullable=False),
        # ID-64.11 (S296): filename / mime_type / file_size are NOT NULL in prod
        # and were never written. Derived from the File (basename / suffix-mime /
        # byte size) per decision-graph Q1.9 Option α (slim-and-keep). The 4th α
        # NOT-NULL col `original_filename` is RELAXED to NULLABLE by the companion
        # migration (α retires it), so it is intentionally not written here.
        "filename": ColumnDef(type="text", nullable=False),
        "mime_type": ColumnDef(type="text", nullable=False),
        "file_size": ColumnDef(type="integer", nullable=False),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow (28.9)
        # Pullmd extraction provenance (ID-42.9, TECH §WP-E) — fanned out from the
        # PullmdResult headers via `extract_source_provenance` (NOT the str-only
        # convert_binary_to_markdown). Both nullable per the CHECK-enum migration
        # 20260526074944_id42_pullmd_provenance.sql.
        "extraction_method": ColumnDef(type="text", nullable=True),
        "pullmd_share_id": ColumnDef(type="text", nullable=True),
        # URL provenance (ID-75 BI-4; M1 §3 — 20260606121451_id75_reference_
        # items_layer.sql). URL-sourced documents write the normalised URL
        # (= storage_path, RESEARCH constraint 2); the localfs branch writes an
        # explicit None.
        "source_url": ColumnDef(type="text", nullable=True),
    },
    primary_key=("id",),
)

# ID-75 (O4/D4) — the reference layer (TECH §WP-A / §WP-C). Columns the
# pipeline writes ONLY: created_at / updated_at are PG-defaulted and OMITTED
# per the existing convention (explicit writes would duplicate the default /
# fight the updated_at trigger). `id` is PIPELINE-MINTED
# uuid5(_KH_PIPELINE_DOC_NS, "ri:"+normalised URL) — deliberately no DB
# default (BI-2 idempotency under a stable PK). `embedding` reuses the
# pgvector text-literal encoder. UNIQUE(source_url) in M1 enforces one
# reference per URL (BI-2/BI-8); NO workspace column exists (BI-7
# RATIFIED-DO-NOT-BUILD).
REFERENCE_ITEMS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "title": ColumnDef(type="text", nullable=False),
        # PullMD/Docling markdown — the canonical body of record (BI-3).
        "body": ColumnDef(type="text", nullable=False),
        "summary": ColumnDef(type="text", nullable=True),
        # Canonical normalised URL — the join contract (BI-4).
        "source_url": ColumnDef(type="text", nullable=False),
        # Original publication time from the ledger; never ingest time (BI-3).
        "published_at": ColumnDef(type="timestamptz", nullable=True),
        "primary_domain": ColumnDef(type="text", nullable=True),
        "primary_subtopic": ColumnDef(type="text", nullable=True),
        # v1 constant 'research' (D-10) — trigger-validated against
        # layer_vocabulary in M1.
        "layer": ColumnDef(type="text", nullable=True),
        # Whole-record embedding — NO chunk table (BI-17, OQ-75-4 ratified).
        "embedding": ColumnDef(
            type="vector(1024)",
            nullable=True,
            encoder=_encode_pgvector,
        ),
        # Provenance chain integrity (BI-15) — RESTRICT FK in M1.
        "source_document_id": ColumnDef(type="uuid", nullable=False),
        # Acquisition route — CV 13 semantics (BI-9 / D-11): 'rss_feed' v1.
        "ingestion_source": ColumnDef(type="text", nullable=False),
        "op_id": ColumnDef(type="uuid", nullable=True),
        # created_at / updated_at PG-defaulted — OMITTED per convention
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

# ID-101 §{101.7} (PC-3 lane). Stage-5 relationship-extraction writes
# entity_relationships rows via `er_target` declared per-doc inside `ingest_file`
# (mounted at app_main below). Mirrors the legacy TS relationship writer
# (`lib/ai/classify.ts:1785-1819`, Inv-16 parity): the table is
# `id, source_entity, relationship_type, target_entity, source_item_id,
# confidence, created_at` only (migration-verified —
# `20260416102457_pre_squash_reconciliation.sql:3660-3670`; no `op_id` migration
# touches this table). `op_id` is therefore OMITTED (RULING 2). `created_at` is a
# PG server-default column and is OMITTED per the same OMIT mechanism the schemas
# above use for PG-defaulted / GENERATED columns — declaring it would duplicate
# the DB default. `confidence` is a flat 1.0 at the write site (the raw extractor
# triples carry no per-triple confidence — Inv-16 parity with the TS writer).
ENTITY_RELATIONSHIPS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "source_entity": ColumnDef(type="text", nullable=False),
        "relationship_type": ColumnDef(type="text", nullable=False),
        "target_entity": ColumnDef(type="text", nullable=False),
        "source_item_id": ColumnDef(type="uuid", nullable=False),
        "confidence": ColumnDef(type="numeric", nullable=True),
    },
    primary_key=("id",),
)

# The EXACTLY-10 relationship predicates of the TS `ExtractedRelationship` union
# (`lib/ai/classify.ts:653-666`) — the Inv-4 parity contract, also the runtime
# `Literal` constraint on `RelationshipExtraction.relationship`
# (extraction.py:415-426). The {101.7} declare loop defensively skips+logs any
# triple whose predicate falls outside this set (Inv-4 — never crash the doc).
_RELATIONSHIP_PREDICATES: frozenset[str] = frozenset(
    {
        "holds",
        "complies_with",
        "delivers_to",
        "uses",
        "demonstrated_by",
        "requires",
        "part_of",
        "supersedes",
        "references",
        "evidences",
    }
)


# ── ID-56 chunking stage (PRODUCT C-10..C-13, C-21, C-30, C-31) ──────────────
# Variant-B chunk config, Liam-ratified {56.5} (RecursiveSplitter byte budgets).
# chunk_size is in BYTES; min_chunk_size defaults to chunk_size/2 but is passed
# EXPLICITLY for self-documentation.
CHUNK_SIZE_BYTES = 2000
CHUNK_OVERLAP_BYTES = 200
CHUNK_MIN_SIZE_BYTES = 1000

# `content_chunks` row-level UPSERT target schema (PRODUCT C-13). Only the
# columns the pipeline writes are declared — mirrors the CONTENT_ITEMS_SCHEMA
# style and reuses `_encode_pgvector` for the embedding vector. The
# heading-derived columns (`heading_text` / `heading_level` / `heading_path` /
# `parent_chunk_id`) plus the auto columns (`created_at` / `updated_at`) are
# DELIBERATELY ABSENT: under RecursiveSplitter's budget-driven split no
# heading-derived value exists to stamp (PRODUCT C-13 + [GAP-CMI-004]
# disposition (a) — keep-nullable until {56.14}/{56.15}). Omitting them from
# the schema + the row dict means the 3 nullable columns resolve to NULL and
# `heading_path` resolves to its DB default `'{}'::text[]` (NOT NULL). This is
# the same OMIT mechanism the schemas above use for `content_text_hash`
# (GENERATED ALWAYS) and the entity_mentions PG-defaulted columns.
CONTENT_CHUNKS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "content_item_id": ColumnDef(type="uuid", nullable=False),
        "content": ColumnDef(type="text", nullable=False),
        # `position` / `char_count` / `word_count` are smallint/integer columns;
        # declared `integer` (no smallint ColumnDef precedent in this module) —
        # values are well within int range and PG implicitly casts int4→int2 on
        # INSERT for the smallint `position` column.
        "position": ColumnDef(type="integer", nullable=False),
        "char_count": ColumnDef(type="integer", nullable=False),
        "word_count": ColumnDef(type="integer", nullable=False),
        "embedding": ColumnDef(
            type="vector(1024)",
            nullable=True,
            encoder=_encode_pgvector,
        ),
        "op_id": ColumnDef(type="uuid", nullable=True),  # stamped per-flow ({56.6})
    },
    primary_key=("id",),
)


# ── ID-52 Path B form-extraction substrate (TECH §2.5) ───────────────────────

# Pipeline service-account user id (CLAUDE.md gotcha: NEVER a literal string in
# any write path). Stamped as `form_templates.created_by` for pipeline-owned
# instance rows (Inv-6 — the pipeline owns the write, not an interactive user).
SERVICE_ACCOUNT_UUID = uuid.UUID("a0000000-0000-4000-8000-000000000001")

# The three CHECK-permitted MIME types on `form_templates.mime_type` (widened
# from DOCX-only by Migration M1, TECH §2.6). Keyed by the lowercased file
# suffix the orchestrator dispatches on. `.xls` is intentionally absent — it is
# out of automated scope (Inv-3) and the orchestrator returns None for it before
# any `form_templates` write is attempted.
MIME_BY_SUFFIX: dict[str, str] = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# ID-80.8 (80.2 §B.3, candidate 5 — secondary suffix guard): a non-form suffix
# under a `route:"forms"` manifest prefix is a manifest mis-wire (an operator
# put content under a forms folder, or mis-tagged the prefix) and is surfaced
# LOUDLY with zero rows. NB: HTML is not a form format — the form orchestrator
# dispatches .pdf/.xlsx/.docx only, and the form_templates.mime_type CHECK
# permits DOCX/PDF/XLSX.
_NON_FORM_SUFFIXES: frozenset[str] = frozenset({".md", ".txt", ".html"})

# ID-64.11 (S296): source_documents.mime_type is NOT NULL and the pipeline
# ingests every type the Stage-2 adapters route (md/markdown/txt/html/htm in
# addition to the pdf/docx/xlsx in MIME_BY_SUFFIX). This fallback covers the
# non-binary suffixes deterministically (stdlib mimetypes varies by platform —
# .md in particular). Resolution order: authoritative binary map -> stdlib guess
# -> this fallback -> generic octet-stream (never None, so the NOT NULL holds).
_SOURCE_MIME_FALLBACK: dict[str, str] = {
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
}


def _resolve_source_mime(path: Path) -> str:
    """Resolve a non-NULL MIME type for a source_documents row from its path."""
    suffix = path.suffix.lower()
    if suffix in MIME_BY_SUFFIX:
        return MIME_BY_SUFFIX[suffix]
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or _SOURCE_MIME_FALLBACK.get(suffix, "application/octet-stream")

# `form_templates` row-level UPSERT target schema (TECH §2.5 step 3). Column
# types mirror the live staging schema (verified against
# supabase/types/database.types.ts): file_size = integer NOT NULL; status,
# ingest_source NOT NULL (DB defaults exist but the pipeline writes explicit
# values); deadline = timestamptz; created_by nullable; the M1b dedicated
# metadata columns (form_type / deadline / issuing_organisation /
# evaluation_methodology) are written from day one (no JSONB packing). The
# GENERATED / auto columns `created_at` / `updated_at` are OMITTED per the
# `content_text_hash GENERATED ALWAYS` convention used by the schemas above.
# PRODUCT Inv-17 (graceful-empty-with-recorded-reason, ratified S278). The
# machine-readable token stamped onto a `form_templates` row when a
# structurally readable form yields ZERO extractable fields. The row STAYS
# `status='analysed'` (graceful — distinct from the `analysis_failed`
# strict-raise path) but carries this reason so an `analysed`/0-field row is
# never left with no recorded reason — the shape Inv-17 forbids.
FORM_WRITE_GRACEFUL_EMPTY_REASON = "graceful_empty_no_fields"

FORM_TEMPLATES_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "workspace_id": ColumnDef(type="uuid", nullable=False),
        "created_by": ColumnDef(type="uuid", nullable=True),
        "name": ColumnDef(type="text", nullable=False),
        "filename": ColumnDef(type="text", nullable=False),
        "file_size": ColumnDef(type="integer", nullable=False),
        "mime_type": ColumnDef(type="text", nullable=False),
        "storage_path": ColumnDef(type="text", nullable=False),
        "structure_path": ColumnDef(type="text", nullable=True),
        "description": ColumnDef(type="text", nullable=True),
        "field_count": ColumnDef(type="integer", nullable=True),
        "mapped_count": ColumnDef(type="integer", nullable=True),
        "status": ColumnDef(type="text", nullable=False),
        "ingest_source": ColumnDef(type="text", nullable=False),
        "form_type": ColumnDef(type="text", nullable=True),
        "deadline": ColumnDef(type="timestamptz", nullable=True),
        "issuing_organisation": ColumnDef(type="text", nullable=True),
        "evaluation_methodology": ColumnDef(type="text", nullable=True),
    },
    primary_key=("id",),
)

# `form_template_fields` row-level UPSERT target schema (TECH §2.5 step 4).
# `field_type` / `fill_status` / `sequence` are NOT NULL (the pipeline always
# supplies them). `is_mandatory` + `reference_urls` are the M1-added substrate
# (TECH §2.5a / §2.6). DB-default / Path-C-owned columns
# (`mapping_status` default, `fill_error`, `question_id`, `mapping_confidence`)
# and the GENERATED / auto columns `created_at` / `updated_at` are OMITTED.
FORM_TEMPLATE_FIELDS_SCHEMA = TableSchema(
    columns={
        "id": ColumnDef(type="uuid", nullable=False),
        "template_id": ColumnDef(type="uuid", nullable=False),
        "question_text": ColumnDef(type="text", nullable=True),
        "placeholder_text": ColumnDef(type="text", nullable=True),
        "field_type": ColumnDef(type="text", nullable=False),
        "fill_status": ColumnDef(type="text", nullable=False),
        "row_index": ColumnDef(type="integer", nullable=True),
        "col_index": ColumnDef(type="integer", nullable=True),
        "table_index": ColumnDef(type="integer", nullable=True),
        "section_name": ColumnDef(type="text", nullable=True),
        "sequence": ColumnDef(type="integer", nullable=False),
        "word_limit": ColumnDef(type="integer", nullable=True),
        "is_mandatory": ColumnDef(type="boolean", nullable=True),
        "reference_urls": ColumnDef(type="text[]", nullable=True),
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


def _stamp_if_model(obj: Any, *, op_id: "uuid.UUID", content_items_id: "uuid.UUID") -> Any:
    """Stamp an extraction's flow metadata via `stamp_extraction_base`, but
    ONLY when ``obj`` is a genuine Pydantic extraction model ({66.16}).

    PRODUCT Inv-5 [RATIFIED-S241] requires every extraction variant to carry
    op_id / content_items_id / extracted_at, populated by the flow wrapper —
    OUTSIDE the memo boundary (bl-220 / ID-74). The production Path-A extractors
    return the stamp-FREE core types (`ClassificationExtraction` /
    `QAFormExtraction` / `EntityMentionExtraction`); `stamp_extraction_base`
    CONSTRUCTS the matching full `*Stamped` type from the core + the resolved
    op_id / content_items_id / extracted_at, and that stamped object is what the
    downstream row writers read. The deterministic write-path test stubs return
    plain dicts (which have no `model_dump`), so those are passed through
    untouched. The shape-agnostic guard mirrors `_field`: a dict goes straight
    back; anything else is stamped via the module-level `stamp_extraction_base`
    (monkeypatchable on `flow` for the wiring proof). Explicit kwargs are
    mandatory — the cocoindex daemon thread does not inherit the FLOW_META_CTX
    binding ({66.19}/S294).
    """
    if isinstance(obj, dict) or not hasattr(obj, "model_dump"):
        return obj
    return stamp_extraction_base(
        obj, op_id=op_id, content_items_id=content_items_id
    )


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


# The workspace manifest filename — lives at the ingest source root, loaded ONCE
# at flow start (app_main) and ALSO enumerated by walk_dir as an item. It is NOT
# content: ingest_file skips it ({66.23}/BUG-B, S297) so it never reaches
# convert_binary_to_markdown (which raises ValueError on a '.json' suffix).
_WORKSPACE_MANIFEST_FILENAME = ".kh-workspace-map.json"


def _to_source_relative(path: Path, source_path: Any) -> str:
    """Return `path` as a POSIX string relative to the ingest source root.

    {66.22}/BUG-A (S297): cocoindex's `File.file_path.path` is ABSOLUTE in
    production (`/cocoindex-state/corpus/test/x.md`) despite the 1.0.3
    "relative to source base dir" docstring (observed wrong on the live smoke).
    The workspace-manifest prefixes (e.g. `test/`) are source-RELATIVE, so the
    resolver (`resolve_route`) only matches the source-relative form; it is
    also the stable seed for the deterministic per-document uuid5 PKs (portable
    across mount points / re-ingests). Returns the plain POSIX path when
    `source_path` is None (in-task unit-test callers) or when `path` is not
    under `source_path` (already relative, or external). Pure-path computation —
    no `.resolve()` I/O — keeps it deterministic.
    """
    if source_path is not None:
        try:
            return path.relative_to(source_path).as_posix()
        except ValueError:
            pass  # not under source_path -> already relative, or external
    return path.as_posix()


@coco.fn(memo=True)
async def ingest_file(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    ci_target: Any,
    qa_target: Any,
    sd_target: Any,
    em_target: Any,
    ft_target: Any,
    ftf_target: Any,
    cc_target: Any = None,
    er_target: Any = None,
    *,
    flow_op_id: "uuid.UUID | None" = None,
    flow_stage_counter: Any = None,
    flow_retry_counter: Any = None,
    flow_taxonomy_miss_counter: Any = None,
    flow_workspace_manifest: Any = None,
    flow_source_path: Any = None,
) -> None:
    """Ingest ONE source file: convert → extract → declare rows on each target.

    Mounted once per source item by `coco.mount_each`. cocoindex 1.0.3 calls
    this component as `ingest_file(File, ci, qa, sd, em, ft, ftf)` — the item
    VALUE (the `File`) is the first positional arg, followed by the extra args
    (`ci/qa/sd/em/ft/ftf` targets) passed positionally to `mount_each`. The
    (key,value) pair from `walk_dir().items()` is `(relative_path_str, File)`;
    the KEY is consumed by `mount_each` for per-item subpath routing only and is
    NOT passed to `fn` (verified against installed cocoindex 1.0.3
    `_internal/api.py` `_mount_one`: `fn(item, *extra_args)`). The stable
    per-document identity is therefore derived INSIDE the body from
    `file.file_path.path` — there is no `rel_path` parameter.

    `ft_target` / `ftf_target` (ID-52.12) are the `form_templates` /
    `form_template_fields` row-level UPSERT targets. The Path-B form-write block
    at the end of the body declares onto them ONLY for form-bearing files that
    resolve to a workspace and extract successfully (TECH §2.5); markdown /
    content files leave both untouched.

    `cc_target` (ID-56.8) is the `content_chunks` chunk-row UPSERT target. It is
    a DEFAULTED 8th positional (defaults to None) so the 7-arg legacy callers
    stay valid: when None, the budget-driven chunking block is skipped entirely.
    When supplied, the chunking block runs AFTER the parent `content_items`
    declare (FK safety + memo cascade) and declares one `content_chunks` row per
    RecursiveSplitter chunk (PRODUCT C-10..C-13).

    `er_target` (ID-101 §{101.7}) is the `entity_relationships` row-level UPSERT
    target. It is a DEFAULTED 9th positional (defaults to None) appended AFTER
    `cc_target` (RULING 1 — defaulted trailing positional, before the keyword-only
    `*`) so the existing 7-/8-arg callers stay valid: when None, the relationship
    declare loop is skipped entirely. When supplied, the loop runs in the content
    branch AFTER the entity_mentions declares and declares one entity_relationships
    row per distinct canonicalised triple (Inv-4 / Inv-16 parity with the legacy TS
    writer at lib/ai/classify.ts:1785-1819).

    This is the reactive 1.0.3 write path proven in RESEARCH.md §R2/§R3 — the
    per-MIME conversion (Stage 2, P-3) and Path A extraction (Stage 3) run as
    plain awaits INSIDE the component body (NOT flow-scope `.transform()`
    chaining, which is fictional in 1.0.3), and each row lands via
    `TableTarget.declare_row(row=...)` (Stage 6).

    `op_id` is a PLAIN ROW FIELD. ID-66.19 threads it (and the four per-flow
    counters + the workspace manifest) as EXPLICIT keyword args
    (`flow_op_id` / `flow_stage_counter` / `flow_retry_counter` /
    `flow_taxonomy_miss_counter` / `flow_workspace_manifest` /
    `flow_source_path`) bound onto the component via a named closure in
    `app_main`, NOT via `contextvars`
    propagation. cocoindex 1.0.3 runs this per-item component on its OWN
    `_LoopRunner` daemon thread (a separate event loop), which does NOT copy the
    binder task's `ContextVar` snapshot across the dispatch boundary — so reads
    of `current_flow_meta()` / `current_stage_counter()` /
    `current_workspace_manifest()` here would return the ContextVar DEFAULT
    (`None`) and the flow would land ZERO rows. The closure's captured cells live
    on the function object, so they cross the daemon-thread boundary intact.
    The keyword args DEFAULT to None so the existing in-task unit-test callers
    (which `await ingest_file(...)` inside a `bind_flow_meta` scope) keep working
    via the ContextVar fallback below.

    CAVEAT (ID-66.19): `extraction.py`'s `stamp_extraction_base` + the
    retry / taxonomy-miss recorders read `current_flow_meta()` /
    `current_retry_counter()` / `current_taxonomy_miss_counter()` INSIDE the
    per-item extractor calls, which run on the SAME daemon thread as this body.
    So once the explicit args arrive we RE-BIND those three ContextVars LOCALLY
    around the body (Option A moves the BIND POINT from `app_main`'s wrong thread
    into this correct thread). `stage_counter` / `workspace_manifest` are read
    directly from the passed args (only this body reads them), so they need no
    re-bind.

    `content_text_hash` is OMITTED (GENERATED ALWAYS column). `embedding` is now
    a real text-embedding-3-large vector(1024) computed from content_text via
    `embed_content_text()` (Stage 4 — ID-49.2); per-row upsert logging (28.25) is
    still deferred and wired in a later subtask.

    @coco.fn(memo=True): {75.17} real-engine probe CORRECTION to the earlier
    Inv-11 framing (the same correction applied to `ingest_url`) — the memo
    fingerprint ALSO covers the `flow_op_id` kwarg, and `app_main` mints a fresh
    op_id per walk, so across walks this component RE-RUNS for every enumerated
    item (cheaply: the inner conversion/extraction memos — `_docling_to_markdown`,
    the `embed_content_text` / classification seams — memo-hit on unchanged
    content). A true memo-hit happens only WITHIN one walk / op_id, never across
    walks (RESEARCH.md §R4). The inner memos are what protect the LLM seams from
    re-running on unchanged bytes.
    """
    # {66.23}/BUG-B (S297): the workspace manifest lives at the source root and
    # is loaded once at flow start (app_main), but localfs.walk_dir ALSO
    # enumerates it as an item. It is NOT content — skip it before any context
    # resolution or conversion (convert_binary_to_markdown raises ValueError on
    # a '.json' suffix, which aborted per-item processing on the live smoke).
    if file.file_path.path.name == _WORKSPACE_MANIFEST_FILENAME:
        _logger.info(
            json.dumps(
                {
                    "event": "cocoindex.ingest.skip_manifest",
                    "file": _WORKSPACE_MANIFEST_FILENAME,
                }
            )
        )
        return

    import contextlib

    # Canonical single-namespace import post-{67.2} (function-local to preserve
    # the original lazy-import timing). One module copy means a single
    # ContextVar store, so bound meta is always visible here (the prior
    # `__package__`-relative `import_module` indirection is retired).
    from scripts.cocoindex_pipeline import flow_context as flow_context_module

    # ID-66.19 — resolve the run context. PREFER the explicit args (threaded via
    # the named closure in app_main — these survive the daemon-thread dispatch).
    # FALL BACK to the ContextVars for the existing in-task unit-test callers
    # that drive ingest_file inside an `async with bind_flow_meta(...)` scope.
    op_id = flow_op_id
    if op_id is None:
        meta = flow_context_module.current_flow_meta()
        op_id = None if meta is None else meta.op_id
    if op_id is None:
        raise RuntimeError(
            "ingest_file invoked without a run op_id — app_main must pass "
            "`flow_op_id=` (via the named closure) or wrap the in-task caller in "
            "`async with bind_flow_meta(op_id=...)`."
        )

    # Inv-17 stage observability (ID-55.2): the per-flow stage counter, threaded
    # explicitly as `flow_stage_counter` (ID-66.19) or read from the ContextVar
    # for in-task callers. `app_main` folds it into `stage_counts` at flow end
    # (mirrors the embedding/entity_resolution folds). When neither is supplied
    # `_bump` is a silent no-op — the row still lands; only observability is
    # skipped (graceful-degradation contract shared with the retry counter).
    stage_counter = flow_stage_counter
    if stage_counter is None:
        stage_counter = flow_context_module.current_stage_counter()

    # CAVEAT (ID-66.19): RE-BIND flow_meta / retry_counter / taxonomy_miss_counter
    # LOCALLY on THIS (daemon) thread so `extraction.py`'s in-task reads
    # (`stamp_extraction_base` / the retry `before_sleep` hook / the
    # `_surface_out_of_taxonomy_classification` validator) see the run context.
    # The explicit args are the bind SOURCE; if they were not supplied (in-task
    # unit-test callers) the bindings are already active on this same task, so we
    # enter no-op `nullcontext`s to avoid double-binding/clobbering.
    rebind_meta: Any = contextlib.nullcontext()
    if flow_op_id is not None:
        rebind_meta = flow_context_module.bind_flow_meta(op_id=flow_op_id)
    rebind_retry: Any = contextlib.nullcontext()
    if flow_retry_counter is not None:
        rebind_retry = flow_context_module.bind_retry_counter(flow_retry_counter)
    rebind_taxonomy: Any = contextlib.nullcontext()
    if flow_taxonomy_miss_counter is not None:
        rebind_taxonomy = flow_context_module.bind_taxonomy_miss_counter(
            flow_taxonomy_miss_counter
        )

    async with rebind_meta, rebind_retry, rebind_taxonomy:
        await _ingest_file_body(
            file,
            ci_target,
            qa_target,
            sd_target,
            em_target,
            ft_target,
            ftf_target,
            cc_target,
            er_target,
            op_id=op_id,
            stage_counter=stage_counter,
            flow_workspace_manifest=flow_workspace_manifest,
            flow_source_path=flow_source_path,
            flow_context_module=flow_context_module,
        )


async def _ingest_file_body(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    ci_target: Any,
    qa_target: Any,
    sd_target: Any,
    em_target: Any,
    ft_target: Any,
    ftf_target: Any,
    cc_target: Any,
    er_target: Any = None,
    *,
    op_id: "uuid.UUID",
    stage_counter: Any,
    flow_workspace_manifest: Any,
    flow_source_path: Any,
    flow_context_module: Any,
) -> None:
    """The Stage 2→6 per-item body of `ingest_file` (ID-66.19 split).

    Factored out of `ingest_file` so the wrapper owns the ID-66.19 run-context
    resolution + local ContextVar re-bind (which must happen on the daemon
    thread) and this body owns the actual convert → extract → declare-rows work.
    `op_id` + `stage_counter` are already resolved; `flow_workspace_manifest` is
    the explicit Path-B manifest arg (preferred over the ContextVar read at the
    fork below).

    ID-80.8 (80.2 §B.1/§B.3): this body is the DISPATCHER and owns THE FORK.
    It derives `rel_path`, bumps `source_walk`, resolves the manifest route
    ONCE (`resolve_route` — a pure function of `rel_path` + manifest, so the
    same file deterministically takes the same branch every run, 80.2 §B.6),
    then runs EXACTLY ONE branch:

      - `route == "forms"` → `_ingest_form_branch` (ft/ftf targets ONLY);
      - otherwise          → `_ingest_content_branch` (ci/qa/sd/em/cc/er ONLY).

    Mutual exclusion is structural — one file, one branch, one write-target
    set. Route defaults to "content" when no manifest is active (Path-A-only
    runs) or when no prefix owns the file (`UnmappedPath` — the bl-219 benign
    soft-warn semantics, preserved at the fork). `AmbiguousResolution` (and
    any future `ResolutionFailure` subtype) fails the file LOUDLY at the fork:
    one `cocoindex.stage_error` and ZERO rows on every target — neither branch
    runs. RATIFIED OQ-80.2-A (Liam, S314, 05/06/2026): forms land ZERO content
    rows; OQ-80.2-B: the manifest per-prefix `route` tag IS the fork point.
    """

    def _bump(stage: str, times: int = 1) -> None:
        if stage_counter is not None:
            for _ in range(times):
                stage_counter.increment(stage)

    # Stable per-document path identity, derived FROM the `File` (NOT a phantom
    # param). `mount_each` passes only the item VALUE (the `File`) to `fn`; the
    # (key,value) key — the relative-path string from `walk_dir().items()` — is
    # consumed by mount_each for subpath routing and never reaches `fn` (1.0.3
    # `_internal/api.py` `_mount_one`: `fn(item, *extra_args)`).
    #
    # {66.22}/BUG-A (S297): `file.file_path.path` is ABSOLUTE in production
    # (`/cocoindex-state/corpus/test/x.md`) — the cocoindex 1.0.3 "relative to
    # source base dir" claim is WRONG as deployed (observed on the live smoke).
    # The workspace-manifest prefixes (`test/`) are source-RELATIVE, so we
    # normalise to the source-relative POSIX string via `flow_source_path`
    # (threaded from app_main — the {66.19} explicit-arg pattern). This is the
    # storage_path AND the seed of the deterministic per-file uuid5 PKs below.
    # Safe to change now: prod has never completed a content write, so no rows
    # are seeded on the old absolute form (no idempotency break).
    rel_path = _to_source_relative(file.file_path.path, flow_source_path)
    # Inv-17: one source item walked + handed to this component per invocation.
    _bump("source_walk")

    # ── THE FORK (ID-80.8, 80.2 §B.1/§B.3) — computed ONCE, BEFORE either
    # write path runs. The manifest-presence gate that previously lived at the
    # top of the form branch moves UP here: PREFER the explicit
    # `flow_workspace_manifest` arg (threaded via the named closure in
    # app_main — survives the daemon-thread dispatch, ID-66.19), FALL BACK to
    # the ContextVar read for the in-task unit-test callers that bind it via
    # `bind_workspace_manifest`.
    manifest = flow_workspace_manifest
    if manifest is None:
        manifest = flow_context_module.current_workspace_manifest()

    # Deterministic per-document uuid5 (a pure function of rel_path) used ONLY
    # for error-log attribution on the fork failure paths below.
    content_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")

    route = "content"  # default: no manifest active (Path-A-only runs)
    resolution: Resolution | None = None
    if manifest is not None:
        try:
            resolution = resolve_route(manifest, rel_path)
            route = resolution.route
        except UnmappedPath as exc:
            # bl-219 preserved at the fork: no prefix owns this file — benign
            # for file content. Soft-warn (WARNING, not a `cocoindex.stage_error`
            # — Inv-26: that event is the companion to a *failed* invocation)
            # and route down the content branch.
            _emit_workspace_unmapped_warn(
                op_id=op_id,
                content_items_id=content_item_id,
                error_message=str(exc),
            )
        except ResolutionFailure as exc:
            # AmbiguousResolution (and any future subtype): a genuine manifest
            # mis-wire. LOUD `cocoindex.stage_error` + ZERO rows on every
            # target — neither branch runs. error_class is one of the six
            # canonical PIPELINE_ERROR_CLASSES (the webhook route Zod-validates
            # it); an ambiguous manifest prefix is an input-validation failure,
            # so `extraction_validation_failed` is the canonical class.
            _emit_stage_error_log(
                op_id=op_id,
                stage="workspace_resolution",
                error_class="extraction_validation_failed",
                content_items_id=content_item_id,
                error_message=str(exc),
            )
            return

    if route == "forms":
        # `resolution` is always non-None here: "forms" is only reachable via
        # a successful `resolve_route` (the defaults above are "content").
        assert resolution is not None
        await _ingest_form_branch(
            file,
            rel_path,
            ft_target,
            ftf_target,
            op_id=op_id,
            _bump=_bump,
            resolution=resolution,
        )
        return

    if route == "qa_sidecar":
        # ID-59 {59.26} (TECH-qa-sidecar P1): the frozen `__qa__/` reserved
        # prefix forks here. `resolution` is always non-None — "qa_sidecar" is
        # only reachable via a successful `resolve_route` (the defaults above are
        # "content"). The branch receives ONLY `sd_target` + `qa_target` (NOT
        # ci/cc/em/er): the type system makes the INV-5 "no content rows"
        # guarantee STRUCTURAL, mirroring how `_ingest_form_branch` receives only
        # ft/ftf.
        assert resolution is not None
        await _ingest_qa_sidecar_branch(
            file,
            rel_path,
            sd_target,
            qa_target,
            op_id=op_id,
            _bump=_bump,
            resolution=resolution,
        )
        return

    # ── INV-5 defensive belt (TECH-qa-sidecar P1.5 / S297 BUG-B): a path under
    # the frozen `__qa__/` reserved prefix that resolves to "content" means the
    # operator forgot the `{path_prefix:"__qa__/", route:"qa_sidecar"}` manifest
    # mapping — the sidecar is about to be ingested as junk content
    # (content_items + chunks + entity_mentions for a Q&A sidecar). WARN loudly
    # so the mis-wire is visible; do NOT mutate the route (the manifest is the
    # source of truth — silently rerouting would mask the operator error).
    if rel_path.startswith("__qa__/"):
        _logger.warning(
            json.dumps(
                {
                    "event": "cocoindex.ingest.qa_sidecar_route_missing",
                    "rel_path": rel_path,
                    "resolved_route": route,
                    "detail": (
                        "path under the frozen __qa__/ reserved prefix resolved "
                        "to 'content' — operator likely forgot the "
                        "{path_prefix:'__qa__/', route:'qa_sidecar'} manifest "
                        "mapping; it will be ingested as junk content (S297 "
                        "BUG-B hazard)"
                    ),
                }
            )
        )

    await _ingest_content_branch(
        file,
        rel_path,
        ci_target,
        qa_target,
        sd_target,
        em_target,
        cc_target,
        er_target,
        op_id=op_id,
        _bump=_bump,
    )


async def _ingest_content_branch(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    rel_path: str,
    ci_target: Any,
    qa_target: Any,
    sd_target: Any,
    em_target: Any,
    cc_target: Any,
    er_target: Any = None,
    *,
    op_id: "uuid.UUID",
    _bump: Any,
) -> None:
    """Path-A content branch — Stage 2→6 (ID-80.7 extraction, 80.2 §B.3).

    Extracted verbatim from `_ingest_file_body`. Touches ONLY the
    ci/qa/sd/em/cc/er targets — it NEVER touches `ft_target` / `ftf_target`.
    `_bump` is the dispatcher's stage-counter closure, threaded through unchanged
    so the Inv-17 stage-count semantics do not shift.

    `er_target` (ID-101 §{101.7}) is the `entity_relationships` UPSERT target. A
    DEFAULTED trailing positional (None for the legacy callers that omit it); when
    supplied, the relationship declare loop runs AFTER the entity_mentions loop.
    """
    # ── Stage 2: binary → markdown (per-MIME adapter, P-3) ──────────────────
    content_text = await convert_binary_to_markdown(file)
    # Inv-17: one binary→markdown conversion completed for this item.
    _bump("binary_conversion")

    # ── Stage 6 prep: provenance fan-out (ID-42.9, TECH §WP-E) ───────────────
    # Resolved via the SEPARATE provenance helper (NOT convert_binary_to_markdown,
    # whose `-> str` content_text contract must stay intact). The file corpus
    # resolves docling/passthrough provenance only — the localfs HTML→PullMD
    # branch is retired (ID-75 WP-D); HTML/pullmd provenance lands via the URL
    # source instead.
    provenance = await extract_source_provenance(file)

    # ── Stage 3: Path A extraction (direct anthropic inside @coco.fn) ───────
    classification = await extract_classification(content_text)
    qa_form = await extract_qa_form(content_text)
    # entity_mentions extraction runs here for memo coverage. The extracted
    # mentions are declared into `em_target` in the Stage-6 declare-rows block
    # below (AFTER content_item_id / rel_path are computed) — ID-53.11 §P-3.
    entity_mentions = await extract_entity_mentions(content_text)
    # ID-101 §{101.7}: relationship extraction runs here for memo coverage. The
    # raw triples are consumed directly by the Stage-6 declare loop below (NO
    # ExtractionOutput-union membership, NO stamped variant — {101.6} returns
    # stamp-free `RelationshipExtraction` cores, canonicalisation + persistence
    # happen at THIS write site, mirroring extract_entity_mentions usage).
    relationships = await extract_relationships(content_text)
    # Inv-17: four Path-A LLM extraction passes ran for this content row
    # (classification + qa_form + entity_mentions + relationships) — mirrors the
    # per-pass semantic of `_record_extraction_success` (ID-28.16): +1 per pass.
    _bump("llm_extraction", times=4)

    # ── Stage 6: declare rows (managed_by=USER row-level upserts) ───────────
    # Deterministic per-DOCUMENT UUIDs seeded on the FIXED namespace + rel_path
    # (NOT op_id), so re-ingesting the same document on any LATER run declares
    # the SAME primary keys → declare_row UPSERTs the existing row and re-stamps
    # its op_id field (PRODUCT Inv-4 idempotency + ratified OQ-A). op_id stays a
    # plain ROW FIELD that identifies the run; it is NOT part of the PK.
    source_document_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")
    content_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")

    # ── Inv-5 [RATIFIED-S241]: stamp the outer-tier flow metadata onto each
    # extraction object ({66.16} stamp-wiring). PRODUCT Inv-5 mandates that every
    # variant carries op_id / content_items_id / extracted_at populated by THIS
    # flow wrapper (not the LLM, which omits them by design → they arrive at the
    # `_UNSTAMPED_*` sentinels). We stamp here, once content_item_id exists, with
    # EXPLICIT kwargs — NOT a FLOW_META_CTX read: cocoindex runs this body on its
    # own `_LoopRunner` daemon thread, which does NOT inherit the binder task's
    # ContextVar snapshot ({66.19}/S294), so explicit kwargs are the only safe
    # channel. `op_id` is the SAME flow-level value already written to every
    # declare_row below, so the ROW writes are unchanged (Inv-15 stays satisfied
    # via the flow op_id). `_stamp_if_model` no-ops on the plain-dict write-path
    # test stubs (which have no `model_dump`); production extractors return the
    # stamp-free core shapes, which `stamp_extraction_base` turns into the full
    # `*Stamped` type here, OUTSIDE the memo boundary (bl-220 / ID-74).
    classification = _stamp_if_model(
        classification, op_id=op_id, content_items_id=content_item_id
    )
    qa_form = _stamp_if_model(qa_form, op_id=op_id, content_items_id=content_item_id)

    # content_fingerprint is an ASYNC METHOD on FileLike returning bytes
    # (cocoindex resources/file.py L172 → connectorkits.fingerprint); await it
    # and encode to hex so it lands in the `text` content_fingerprint column.
    content_fingerprint = (await file.content_fingerprint()).hex()

    sd_target.declare_row(
        row={
            "id": source_document_id,
            "storage_path": rel_path,
            # ID-64.10/64.11 (S296): prod column is `content_hash` (rename); the
            # value is the same awaited file content-hash hex computed above.
            "content_hash": content_fingerprint,
            # ID-64.11 (S296): the NOT-NULL file-metadata cols, derived from the
            # File (Q1.9 Option α slim-and-keep). original_filename is relaxed to
            # NULLABLE by the companion migration (α retires it), so it is omitted.
            "filename": file.file_path.path.name,
            "mime_type": _resolve_source_mime(file.file_path.path),
            "file_size": await file.size(),
            "op_id": op_id,
            # Pullmd provenance (ID-42.9 §WP-E) — nullable; only HTML/pullmd and
            # Docling paths populate them (passthrough leaves both None).
            "extraction_method": provenance.extraction_method,
            "pullmd_share_id": provenance.pullmd_share_id,
            # ID-75 BI-4: a localfs file has NO source URL — explicit None so
            # the localfs/URL provenance split is visible at the write site.
            "source_url": None,
        }
    )
    _bump("postgres_upsert")  # Inv-17: source_documents row upsert

    # ── Stage 4: embedding (text-embedding-3-large → vector(1024), ID-49.2) ──
    # Computed imperatively from the Stage-2 content_text (see embed_content_text
    # docstring). content_text_hash OMITTED (GENERATED ALWAYS); the pgvector
    # text-literal encoding is applied by the `embedding` ColumnDef encoder.
    embedding = await embed_content_text(content_text)
    # ID-64.10 (S296): content_type is the taxonomy-validated classifier value
    # (HARD-rejected at extraction if out-of-taxonomy → present in production);
    # `or "other"` is a defensive floor for the plain-dict write-path test stubs.
    # Hoisted from its former site below the qa loop, where it was computed but
    # never written ("value available but never written" — schema-gap audit).
    content_type = _field(classification, "content_type") or "other"
    ci_target.declare_row(
        row={
            "id": content_item_id,
            # ID-64.10 (S296): `content` is the prod body column (rename from the
            # non-existent `content_text`).
            "content": content_text,
            # ID-64.10 (S296): title (NOT NULL) — classifier suggested_title with
            # a filename-stem fallback (decided S296); content_type (NOT NULL).
            "title": _field(classification, "suggested_title")
            or file.file_path.path.stem,
            "content_type": content_type,
            "embedding": embedding,
            "source_document_id": source_document_id,
            "op_id": op_id,
            # ID-63.7 (OQ-63-9): persist the classifier's domain AND subtopic
            # to content_items — today neither was written on this path. Read
            # via _field so the write path stays agnostic to whether the
            # extractor returned a Pydantic model (production) or a plain dict
            # (write-path test stubs) — mirrors the content_type access above.
            "primary_domain": _field(classification, "primary_domain"),
            "primary_subtopic": _field(classification, "primary_subtopic"),
        }
    )
    _bump("postgres_upsert")  # Inv-17: content_items row upsert
    # Inv-17: one embedding vector produced for this content row (the gap
    # inherited from ID-49.2 — the counter was initialised to 0 and never
    # incremented; ID-49.4 closed it for embedding, ID-55.2 generalises the
    # substrate to the remaining stages via `_bump`).
    _bump("embedding")

    # ── ID-56.8: chunking stage (RecursiveSplitter → content_chunks) ─────────
    # Runs AFTER the parent content_items declare so the FK is satisfiable and
    # the memo cascade is correct (TECH §2.7): chunking lives inside this same
    # @coco.fn(memo=True) body, so an unchanged-bytes re-ingest skips the whole
    # ingest_file component → no re-chunk, op_id retained (PRODUCT C-31). Gated
    # on `cc_target is not None` so the 7-arg legacy callers skip it.
    # Variant-B byte budgets (Liam-ratified {56.5}); min_chunk_size passed
    # EXPLICITLY though it equals the chunk_size/2 default. RecursiveSplitter is
    # the cocoindex-native splitter (cocoindex.functions.SplitRecursively is
    # ABSENT in 1.0.3 — V-1 trap). Each chunk's `.text` is the chunk string;
    # `.start`/`.end` are TextPosition objects (char_offset/byte_offset) — not
    # used here, the budget split needs only the text.
    if cc_target is not None:
        # Lazy import: `cocoindex.ops.text` is a real submodule of the installed
        # package, but the deterministic flow-import test harnesses stub the
        # `cocoindex` parent as a bare MagicMock (not a package), so a module-top
        # `from cocoindex.ops.text import RecursiveSplitter` would raise
        # ModuleNotFoundError under those stubs. Importing inside the chunking
        # block (only reached when a real cc_target is supplied) keeps the 7-arg
        # legacy callers — which pass cc_target=None and never enter here —
        # import-clean, mirroring the function-local flow_context import used
        # above.
        from scripts.cocoindex_pipeline._coco_api import (  # noqa: PLC0415
            RecursiveSplitter,
        )

        splitter = RecursiveSplitter()
        chunks = splitter.split(
            content_text,
            CHUNK_SIZE_BYTES,
            chunk_overlap=CHUNK_OVERLAP_BYTES,
            min_chunk_size=CHUNK_MIN_SIZE_BYTES,
        )
        for position, chunk in enumerate(chunks):
            chunk_embedding = await embed_content_text(chunk.text)
            cc_target.declare_row(
                row={
                    # Deterministic per-(document,position) PK so a re-ingest
                    # UPSERTs the same rows (idempotency — mirrors ftf:/em: idiom).
                    "id": uuid.uuid5(
                        _KH_PIPELINE_DOC_NS, f"chunk:{rel_path}:{position}"
                    ),
                    "content_item_id": content_item_id,
                    "content": chunk.text,
                    "position": position,
                    "char_count": len(chunk.text),
                    "word_count": len(chunk.text.split()),
                    "embedding": chunk_embedding,
                    "op_id": op_id,
                    # heading_text / heading_level / heading_path /
                    # parent_chunk_id OMITTED ([GAP-CMI-004] disposition (a),
                    # PRODUCT C-13): budget split preserves no semantic heading
                    # boundary. → NULL for the 3 nullable cols; heading_path →
                    # DB default '{}'. Kept nullable until {56.14}/{56.15}.
                }
            )
            # Inv-11 (ID-56.8): one content_chunks row declared for this item.
            # `_bump` is the local helper (no-op when no stage counter bound),
            # matching the surrounding embedding/postgres_upsert bumps — the
            # ID-63 refactor replaced the original explicit `stage_counter.
            # increment(...)` guard with this helper.
            _bump("chunking")

    qa_pairs = _field(qa_form, "qa_pairs", []) or []
    for idx, pair in enumerate(qa_pairs):
        qa_target.declare_row(
            row={
                "id": uuid.uuid5(_KH_PIPELINE_DOC_NS, f"qa:{rel_path}:{idx}"),
                "source_content_item_id": content_item_id,
                "extractor_kind": "llm_extraction",
                "extracted_question_text": _field(pair, "question_text", ""),
                "extracted_answer_text": _field(pair, "answer_text"),
                # ID-54.1 (OQ-52-LOSSY): stop dropping the 4 QAPair form-question
                # fields. expected_response_kind is required in Pydantic so the
                # None default is defensive; it matches the nullable DB column.
                "expected_response_kind": _field(pair, "expected_response_kind"),
                "evaluation_criteria": _field(pair, "evaluation_criteria"),
                "evidence_requirements": _field(pair, "evidence_requirements", []),
                "scope_tags": _field(pair, "scope_tags", []),
                # ID-94.1 (G4): the LLM-emitted alternate question phrasings reach
                # q_a_extractions.alternate_question_phrasings (text[] NOT NULL
                # DEFAULT '{}', migration 20260608210723). Defaults to [] when the
                # pair omits them — matches the QAPair.question_phrasings default
                # and the DB column default. Carried through to
                # q_a_pairs.alternate_question_phrasings at UC5 promotion (ID-45).
                "alternate_question_phrasings": _field(
                    pair, "question_phrasings", []
                ),
                "extraction_metadata": {
                    "extraction_kind": _field(qa_form, "extraction_kind", "q_a_form"),
                    "qa_index": idx,
                    "rel_path": rel_path,
                },
                "op_id": op_id,
            }
        )
        _bump("postgres_upsert")  # Inv-17: one q_a_extractions row upsert

    # ── Stage 5 substrate: entity_mentions rows (ID-53.11 §P-3) ──────────────
    # Each distinct (canonical_name, entity_type) the LLM returned becomes ONE
    # entity_mentions row for this document. canonicalise_entity_name +
    # extract_entity_context are SYNCHRONOUS helpers (return str). The per-doc
    # canonical lands in canonical_name BEFORE Stage-5 cross-document resolution
    # runs (Inv-4); Stage-5's UPDATE may later rewrite it. Pydantic
    # `mention_confidence` maps to DB `confidence` (Inv-15); source spans stash in
    # the metadata jsonb (Inv-16); context_snippet is NOT NULL (Inv-17). op_id is
    # the per-flow run stamp (Inv-7).
    #
    # {66.16}/BUG-F (S297): prod enforces UNIQUE (canonical_name, entity_type,
    # content_item_id) — ONE row per (canonical entity, type) per document. The
    # LLM may emit the SAME entity multiple times, so DEDUP per
    # (per_doc_canonical, entity_type) keeping the highest-confidence mention, and
    # seed the deterministic PK on that NATURAL key (NOT the mention index). The
    # old `em:{rel_path}:{idx}` PK gave distinct ids to duplicate entities, so the
    # cocoindex upsert's ON CONFLICT (id) did not absorb them and the natural-key
    # unique constraint raised UniqueViolationError; the natural-key PK both
    # collapses the duplicates and keeps re-ingest idempotent.
    #
    # ── Holder-rule attribution (ID-101 §{101.8}, PC-5) ──────────────────────
    # Derive per-cert holder metadata ONCE per doc from the SAME raw mentions +
    # the {101.7} `relationships` list (reused, NOT re-extracted). The result is
    # a {(per_doc_canonical, entity_type): holder_md} map the em-declare loop
    # below merges into each cert mention's metadata jsonb (span keys PRESERVED).
    # `derive_holder_metadata` is a PURE function (no LLM); it raises (R4) when
    # the required PIPELINE_CLIENT_ORG knob is unset. Inv-15 best-effort: any
    # stamp fault (incl. that raise) is LOGGED and the em declares still happen
    # with span-only metadata — a holder-derivation fault never aborts the doc.
    # The client org is relationship-canonicalised so the self-vs-supplier
    # comparison lands in the same space as the relationship-canonical holds
    # sources (see holder_rule.py docstring).
    _holder_by_mention_id: dict[tuple[str, str], dict[str, Any]] = {}
    try:
        _client_org_raw = os.environ.get(CLIENT_ORG_ENV_VAR, "")
        _client_org_lower = canonicalise_for_relationship(_client_org_raw)
        _holder_by_mention_id = derive_holder_metadata(
            entity_mentions, relationships, _client_org_lower
        )
    except Exception as exc:  # noqa: BLE001 — Inv-15 best-effort holder stamp
        _logger.warning(
            json.dumps(
                {
                    "event": "cocoindex.ingest.holder_derivation_failed",
                    "rel_path": rel_path,
                    "error": _redact_error_message(str(exc)),
                }
            )
        )

    _em_dedup: dict[tuple[str, str], Any] = {}
    for mention in entity_mentions:
        per_doc_canonical = canonicalise_entity_name(
            mention.entity_name, mention.entity_type
        )
        key = (per_doc_canonical, mention.entity_type)
        kept = _em_dedup.get(key)
        if kept is None or (mention.mention_confidence or 0.0) > (
            kept.mention_confidence or 0.0
        ):
            _em_dedup[key] = mention

    for (per_doc_canonical, entity_type), mention in _em_dedup.items():
        # Inv-5 [RATIFIED-S241] stamp ({66.16}): the EntityMentionExtraction
        # carries the flow op_id + this row's content_item_id (explicit kwargs —
        # the daemon-thread boundary forbids a FLOW_META_CTX read, {66.19}/S294).
        mention = _stamp_if_model(
            mention, op_id=op_id, content_items_id=content_item_id
        )
        context_snippet = extract_entity_context(content_text, mention.entity_name)
        # ID-101 §{101.8}: MERGE holder keys into the span metadata — span keys
        # are PRESERVED, holder keys are added (never overwriting a span key).
        # Non-cert / no-signal mentions resolve to {} so only span keys remain.
        holder_md = _holder_by_mention_id.get((per_doc_canonical, entity_type), {})
        em_target.declare_row(
            row={
                "id": uuid.uuid5(
                    _KH_PIPELINE_DOC_NS,
                    f"em:{rel_path}:{per_doc_canonical}:{entity_type}",
                ),
                "content_item_id": content_item_id,
                "entity_type": mention.entity_type,
                "entity_name": mention.entity_name,
                "canonical_name": per_doc_canonical,
                "confidence": mention.mention_confidence,  # Inv-15 map-at-declare-row
                "context_snippet": context_snippet,
                "metadata": {
                    "source_span_start": mention.source_span_start,
                    "source_span_end": mention.source_span_end,
                    **holder_md,
                },
                "op_id": op_id,
            }
        )
        _bump("postgres_upsert")  # Inv-17: one entity_mentions row upsert

    # ── Stage 5 substrate: entity_relationships rows (ID-101 §{101.7}) ────────
    # Each distinct canonicalised (source, predicate, target) triple the LLM
    # returned becomes ONE entity_relationships row for this document. The raw
    # `RelationshipExtraction` cores (source / relationship / target str fields —
    # NOTE the Pydantic field is `relationship`, NOT `relationship_type`) are
    # consumed directly; both endpoints are canonicalised via
    # `canonicalise_for_relationship` so pipeline-produced endpoints match the
    # legacy TS writer byte-for-byte (lib/ai/classify.ts:1788, Inv-16 parity).
    #
    # Inv-4 (never crash): the {101.6} extractor's `Literal` already constrains
    # the predicate to the 10-set, but the write site defensively skips+logs any
    # out-of-set predicate rather than declaring an invalid relationship_type.
    #
    # Per-doc DEDUP on the canonical (source_c, relationship_type, target_c)
    # natural key keeps re-ingest idempotent AND collapses LLM-emitted duplicates;
    # the deterministic uuid5 PK is seeded on that same natural key (NOT op_id —
    # Inv-4 idempotency: the same triple re-ingests to the same row).
    #
    # `confidence` is a flat 1.0 — the raw extractor triples carry no per-triple
    # confidence (Inv-16 parity with the legacy TS writer, which inserts a flat
    # confidence). `op_id` / `created_at` are NOT declared (RULING 2 — the table
    # has no op_id column per the migration, and created_at is a PG server
    # default).
    #
    # Best-effort parity with the em handling (Inv-7 / Inv-15): a relationship
    # write fault is logged and never aborts the doc's other declares or the
    # batch — the per-item containment at the mount_each boundary (bound_ingest_file)
    # is the outer guard; this inner try/except keeps a single bad triple from
    # short-circuiting the remaining relationship declares for this doc.
    if er_target is not None and relationships:
        try:
            _er_dedup: dict[tuple[str, str, str], dict[str, Any]] = {}
            for rel in relationships:
                predicate = rel.relationship
                if predicate not in _RELATIONSHIP_PREDICATES:
                    # Inv-4: out-of-10-set predicate — skip + log, never crash.
                    _logger.warning(
                        json.dumps(
                            {
                                "event": "cocoindex.ingest.relationship_predicate_skipped",
                                "rel_path": rel_path,
                                "predicate": predicate,
                            }
                        )
                    )
                    continue
                source_c = canonicalise_for_relationship(rel.source)
                target_c = canonicalise_for_relationship(rel.target)
                key = (source_c, predicate, target_c)
                if key in _er_dedup:
                    continue
                _er_dedup[key] = {
                    "id": uuid.uuid5(
                        _KH_PIPELINE_DOC_NS,
                        f"er:{rel_path}:{source_c}:{predicate}:{target_c}",
                    ),
                    "source_entity": source_c,
                    "relationship_type": predicate,
                    "target_entity": target_c,
                    "source_item_id": content_item_id,
                    "confidence": 1.0,
                }
            for row in _er_dedup.values():
                er_target.declare_row(row=row)
                _bump("postgres_upsert")  # Inv-17: one entity_relationships upsert
        except Exception as exc:  # noqa: BLE001 — Inv-7/Inv-15 best-effort parity
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.ingest.relationship_declare_failed",
                        "rel_path": rel_path,
                        "error": _redact_error_message(str(exc)),
                    }
                )
            )


async def _ingest_qa_sidecar_branch(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    rel_path: str,
    sd_target: Any,
    qa_target: Any,
    *,
    op_id: "uuid.UUID",
    _bump: Any,
    resolution: Resolution,
) -> None:
    """Q&A-sidecar branch — ID-59 {59.26} (TECH-qa-sidecar-canonical P1).

    The third walk branch, reached EXCLUSIVELY via the `_ingest_file_body` fork
    when the manifest tags a path's prefix `route:"qa_sidecar"` (the frozen
    `__qa__/` reserved prefix — ID-45 {45.3} freezes it). Extracted from the
    content branch's Q&A-relevant statements ONLY: it mints the INV-8 linkage
    anchor (`source_documents`) and the `q_a_extractions` tier, and NOTHING ELSE.

    Touches ONLY `sd_target` + `qa_target` — it has NO ci/cc/em/er target in its
    signature, making the PRODUCT INV-5 "no content rows" guarantee STRUCTURAL
    (a `content_items` / `content_chunks` / `entity_mentions` / content-embedding
    write is impossible here, mirroring how `_ingest_form_branch` cannot touch
    the content targets). A re-ingest over a folder with N `__qa__/` sidecars
    adds ZERO content_items for those N files (INV-5's load-bearing skip).

    INV-5 nuance (TECH P1, resolved against PRODUCT INV-5's imprecise literal):
    the branch DOES mint exactly ONE `source_documents` row — the INV-8 linkage
    anchor (`q_a_pairs.source_document_id` points at it). That row is NOT a
    `content_items` row. INV-5's real guarantee is ZERO content_items /
    content_chunks / entity_mentions / content embedding.

    INV-6 / COCO.10 two-tier memo (preserved unchanged): the outer file-tier
    memo is `convert_binary_to_markdown(file)` on the `FileLike` handle (same as
    the content branch); the inner `extract_qa_form(content_text)` is a
    content-hash-keyed `@coco.fn(memo=True)` extractor, so a metadata-only touch
    (mtime/owner change, no byte change) hits memo → the LLM is NOT re-called.
    `_bump` is the dispatcher's stage-counter closure, threaded through unchanged
    so the Inv-17 stage-count semantics do not shift.

    `resolution` carries the resolved workspace; it is accepted to mirror the
    `_ingest_form_branch` call shape (the fork passes it on every routed branch)
    even though the workspace-AGNOSTIC sd/qa canonical layer does not consume it.
    """
    # ── Stage 2: binary → markdown (per-MIME adapter) ───────────────────────
    # The sidecar IS markdown, so the conversion is the identity-ish text read.
    # This is ALSO the outer-tier memo boundary (INV-6): an unchanged-bytes
    # re-touch skips the @coco.fn body → no re-extract. `_bump` mirrors the
    # content branch's binary_conversion bump exactly.
    content_text = await convert_binary_to_markdown(file)
    _bump("binary_conversion")  # Inv-17: one binary→markdown conversion

    # ── Deterministic per-DOCUMENT uuid5 linkage anchor (INV-8 / INV-20) ─────
    # The SAME `sd:`-seeded derivation the content branch uses (`:2039`
    # analogue), so the linkage anchor is stable across re-walks and folder
    # reorgs — `q_a_pairs.source_document_id` (M1 / {59.27}) points here.
    source_document_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{rel_path}")

    # `content_fingerprint` is an ASYNC METHOD on FileLike returning bytes;
    # await + hex so it lands in the `content_hash` text column (same as the
    # content branch's source_documents declare).
    content_fingerprint = (await file.content_fingerprint()).hex()

    # ── Mint the INV-8 linkage anchor: ONE source_documents row. This is NOT a
    # content_items row (the content branch's `:2066-2088` analogue, minus the
    # pullmd provenance fan-out the sidecar path never resolves). ──────────────
    sd_target.declare_row(
        row={
            "id": source_document_id,
            "storage_path": rel_path,
            "content_hash": content_fingerprint,
            "filename": file.file_path.path.name,
            "mime_type": "text/markdown",  # the sidecar is always markdown (P1)
            "file_size": await file.size(),
            "op_id": op_id,
        }
    )
    _bump("postgres_upsert")  # Inv-17: source_documents row upsert

    # ── Inner extraction tier (INV-6): the UNCHANGED `extract_qa_form`. ──────
    # Content-hash-keyed @coco.fn(memo=True) — a metadata-only touch hits memo
    # and the LLM is not re-called. Identical extractor the content path calls.
    qa_form = await extract_qa_form(content_text)
    _bump("llm_extraction")  # Inv-17: one Q&A extraction pass for this sidecar

    # ── q_a_extractions declare loop (`:2196-2228` analogue) with the ONE
    # critical difference: `source_content_item_id = None`. No content_item is
    # minted on this branch, so the linkage column (nullable, flow.py:1185) is
    # explicitly NULL — the INV-5 "no content_items" guarantee made visible at
    # the write site. PK is still the stable `qa:`-seeded uuid5 (idempotent
    # across re-walk). ────────────────────────────────────────────────────────
    qa_pairs = _field(qa_form, "qa_pairs", []) or []
    for idx, pair in enumerate(qa_pairs):
        qa_target.declare_row(
            row={
                "id": uuid.uuid5(_KH_PIPELINE_DOC_NS, f"qa:{rel_path}:{idx}"),
                # INV-5: no content_item minted for a sidecar — the column is
                # nullable; this is the structural "no content rows" marker.
                "source_content_item_id": None,
                "extractor_kind": "llm_extraction",
                "extracted_question_text": _field(pair, "question_text", ""),
                "extracted_answer_text": _field(pair, "answer_text"),
                "expected_response_kind": _field(pair, "expected_response_kind"),
                "evaluation_criteria": _field(pair, "evaluation_criteria"),
                "evidence_requirements": _field(pair, "evidence_requirements", []),
                "scope_tags": _field(pair, "scope_tags", []),
                "alternate_question_phrasings": _field(
                    pair, "question_phrasings", []
                ),
                "extraction_metadata": {
                    "extraction_kind": _field(qa_form, "extraction_kind", "q_a_form"),
                    "qa_index": idx,
                    "rel_path": rel_path,
                },
                "op_id": op_id,
            }
        )
        _bump("postgres_upsert")  # Inv-17: one q_a_extractions row upsert


# ── ID-75 WP-C — URL-source per-item component (`ingest_url`) ────────────────
# Lives beside `ingest_file` per D-6 (a separate flow_url.py would risk a
# circular import against the schemas/extractors/counters this module owns).
# The component declares the sd+ri EVIDENCE PAIR only — it has NO ci/qa/em/cc
# target in its signature, making a `content_items` write structurally
# impossible (BI-1). A content_items uuid5 seed is NEVER minted from a URL
# (BI-2/BI-13) — the only seeds below are the sd/ri pair.


def _url_filename(url: str) -> str:
    """Derive `source_documents.filename` from a URL (BI-4 / WP-C step 5).

    The last URL path segment when one exists, else the hostname (a root URL
    like `https://example.com/` has no segment). Falls back to the raw URL if
    even the hostname is unparsable — `filename` is NOT NULL.
    """
    parts = urlsplit(url)
    segment = parts.path.rstrip("/").rsplit("/", 1)[-1]
    return segment or (parts.hostname or url)


async def _url_is_pdf(url: str) -> bool:
    """D-12 PDF route detection (WP-C step 2).

    `.pdf` path-suffix check first (cheap, deterministic); otherwise an httpx
    HEAD content-type sniff for `application/pdf`. HEAD failure ⇒ assume HTML
    and let PullMD try — its failure is contained per-item (BI-19).
    """
    if urlsplit(url).path.lower().endswith(".pdf"):
        return True
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0), follow_redirects=True
        ) as client:
            resp = await client.head(url)
        content_type = resp.headers.get("Content-Type", "")
        return content_type.split(";")[0].strip().lower() == "application/pdf"
    except httpx.HTTPError:
        return False


async def _fetch_url_bytes(url: str) -> bytes:
    """Fetch PDF bytes for the Docling route (BI-20 / D-12).

    The URL has already passed `validate_url` (step 1 — the SSRF gate runs
    before ANY fetch). Raises on HTTP failure — contained per-item at the
    mount boundary (BI-19), so a dead PDF link never aborts the walk.
    """
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(60.0), follow_redirects=True
    ) as client:
        resp = await client.get(url)
    resp.raise_for_status()
    return resp.content


def _pullmd_extraction_method(x_source: str | None) -> str | None:
    """Map a PullMD X-Source onto `source_documents.extraction_method`.

    Re-implements the {75.9}-retired localfs guard at the URL write site
    (WP-C step 2): only the five known X-Source values map to
    `pullmd_<x_source>`; an unrecognised / missing X-Source DEGRADES to None
    with a structured warning — `pullmd_<unknown>` would violate the
    CHECK enum on `source_documents.extraction_method`
    (20260526074944_id42_pullmd_provenance.sql) at insert time.
    """
    if x_source in _PULLMD_X_SOURCE_METHODS:
        return f"pullmd_{x_source}"
    if x_source is not None:
        _logger.warning(
            json.dumps(
                {
                    "event": "cocoindex.pullmd_unknown_x_source",
                    "x_source": x_source,
                }
            )
        )
    return None


async def _log_ssrf_rejection(
    *,
    source_url: str,
    reason: str,
    op_id: "uuid.UUID",
    ledger_urls: tuple[str, ...],
) -> None:
    """Write the BI-21/D-9 operator surface: one `ingestion_quality_log` row.

    Contract (D-9): `flag_type='ssrf_rejected'` (CHECK extended by M1),
    `severity='error'`, `content_item_id=NULL`,
    `details={source_url, reason, op_id, feed_article_ids}`. The feed-article
    ids are resolved from the raw ledger URLs at rejection time — `UrlItem`
    deliberately does not carry them. Uses the same env-scope `DB_CTX` pool as
    the Stage-5 / `_trim_stale_form_fields` precedents; module-level seam so
    unit tests can observe the contract without a live pool.
    """
    pool = coco.use_context(DB_CTX)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM public.feed_articles "
            "WHERE external_url = ANY($1::text[]) AND passed",
            list(ledger_urls),
        )
        feed_article_ids = [str(row["id"]) for row in rows]
        await conn.execute(
            "INSERT INTO public.ingestion_quality_log "
            "(flag_type, severity, content_item_id, details) "
            "VALUES ($1, $2, NULL, $3::jsonb)",
            "ssrf_rejected",
            "error",
            json.dumps(
                {
                    "source_url": source_url,
                    "reason": reason,
                    "op_id": str(op_id),
                    "feed_article_ids": feed_article_ids,
                }
            ),
        )


# {75.17}: the ONE FK class the step-7/8 backlink write tolerates on walk 1
# (the engine deferred-flush race — see the call site in `_ingest_url_body`).
# Postgres auto-named the constraint from the inline REFERENCES clause in
# migration 20260606121451_id75_reference_items_layer.sql.
_FEED_ARTICLES_RI_FKEY = "feed_articles_reference_item_id_fkey"


async def _backlink_feed_articles(
    reference_item_id: "uuid.UUID", ledger_urls: tuple[str, ...]
) -> None:
    """D-7 backlink (WP-C step 7): point ALL ledger rows at the reference.

    Raw-pool UPDATE keyed on the RAW stored `external_url` values captured at
    enumeration (precise even if normalisation rules ever drift from stored
    values). All N workspace rows for the URL backlink the ONE reference row
    (BI-8/BI-10). Module-level seam, mirroring `_trim_stale_form_fields`.

    {75.17}: raises like any raw pool write — the walk-1 FK-deferral
    tolerance (an exception whose `constraint_name` string-compares equal to
    `_FEED_ARTICLES_RI_FKEY`, and ONLY that) lives at the `_ingest_url_body`
    call site, not here.
    """
    pool = coco.use_context(DB_CTX)
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE public.feed_articles SET reference_item_id = $1 "
            "WHERE external_url = ANY($2::text[]) AND passed",
            reference_item_id,
            list(ledger_urls),
        )


@coco.fn(memo=True)
async def ingest_url(
    item: UrlItem,
    ri_target: Any,
    sd_target: Any,
    *,
    flow_op_id: "uuid.UUID | None" = None,
    flow_stage_counter: Any = None,
    flow_retry_counter: Any = None,
    flow_taxonomy_miss_counter: Any = None,
) -> None:
    """Ingest ONE passed URL: fetch → extract → declare the sd+ri pair.

    Mounted once per source item by `coco.mount_each` over
    `FeedUrlSource.items()` ({75.11} wiring) — cocoindex 1.0.3 calls it as
    `ingest_url(UrlItem, ri_target, sd_target)`; the (key,value) key (the
    normalised URL) is consumed by `mount_each` for subpath routing and never
    reaches `fn` (the `ingest_file` precedent).

    `@coco.fn(memo=True)` memo-keys over the FROZEN `UrlItem` directly —
    EXECUTOR-VERIFY-1 ({75.8}, SUPPORTED) verified empirically that the engine
    fingerprints a frozen dataclass on module, qualname and field VALUES, so
    the scalar-positional fallback is not needed. `content_epoch` rides the
    item (D-4): a bumped epoch re-fetches via `_pullmd_fetch`'s (url, epoch)
    memo. {75.17} real-engine probe CORRECTION to the earlier Inv-11 framing:
    the memo fingerprint ALSO covers the `flow_op_id` kwarg, and `app_main`
    mints a fresh op_id per walk — so across walks this component RE-RUNS for
    every enumerated item (cheaply: `_pullmd_fetch` memo-hits on an unchanged
    epoch). The step-7/8 backlink deferral depends on exactly this re-run
    (convergence by walk 2); a true memo-hit happens only within one walk /
    op_id.

    Run-context resolution mirrors `ingest_file` (ID-66.19): PREFER the
    explicit `flow_*` kwargs threaded via the named closure in `app_main`
    (which survive the daemon-thread dispatch), FALL BACK to the ContextVars
    for in-task unit-test callers under `bind_flow_meta`. The re-bind makes
    `extraction.py`'s in-task reads (retry / taxonomy recorders) see the run
    context on THIS daemon thread.
    """
    import contextlib

    from scripts.cocoindex_pipeline import flow_context as flow_context_module

    op_id = flow_op_id
    if op_id is None:
        meta = flow_context_module.current_flow_meta()
        op_id = None if meta is None else meta.op_id
    if op_id is None:
        raise RuntimeError(
            "ingest_url invoked without a run op_id — app_main must pass "
            "`flow_op_id=` (via the named closure) or wrap the in-task caller "
            "in `async with bind_flow_meta(op_id=...)`."
        )

    stage_counter = flow_stage_counter
    if stage_counter is None:
        stage_counter = flow_context_module.current_stage_counter()

    rebind_meta: Any = contextlib.nullcontext()
    if flow_op_id is not None:
        rebind_meta = flow_context_module.bind_flow_meta(op_id=flow_op_id)
    rebind_retry: Any = contextlib.nullcontext()
    if flow_retry_counter is not None:
        rebind_retry = flow_context_module.bind_retry_counter(flow_retry_counter)
    rebind_taxonomy: Any = contextlib.nullcontext()
    if flow_taxonomy_miss_counter is not None:
        rebind_taxonomy = flow_context_module.bind_taxonomy_miss_counter(
            flow_taxonomy_miss_counter
        )

    async with rebind_meta, rebind_retry, rebind_taxonomy:
        await _ingest_url_body(
            item,
            ri_target,
            sd_target,
            op_id=op_id,
            stage_counter=stage_counter,
        )


async def _ingest_url_body(
    item: UrlItem,
    ri_target: Any,
    sd_target: Any,
    *,
    op_id: "uuid.UUID",
    stage_counter: Any,
) -> None:
    """The WP-C steps 1-8 per-URL body of `ingest_url` (ID-75.10).

    ORDERING (BI-19): `declare_row` runs only AFTER fetch + extraction
    succeed — a failed item lands NO partial rows, and because nothing was
    declared the next walk re-runs it (memo miss on a failure-aborted run).

    BACKLINK DEFERRAL ({75.17}): the step-7/8 backlink write races the
    engine's post-return target flush, so its
    `feed_articles_reference_item_id_fkey` violation on walk 1 is tolerated
    — narrowed by a `constraint_name` STRING COMPARE, never by asyncpg
    exception class (structured `cocoindex.url_backlink_deferred` log, item
    completes, sd/ri flush) — and the backlink converges on walk 2's re-run.
    Every OTHER error in that write still raises into the BI-19 containment.
    """

    def _bump(stage: str, times: int = 1) -> None:
        if stage_counter is not None:
            for _ in range(times):
                stage_counter.increment(stage)

    # Inv-17: one source item enumerated + handed to this component.
    _bump("source_walk")

    # ── Step 1: SSRF gate (BI-21 / D-9) — BEFORE any fetch ──────────────────
    ok, reason = validate_url(item.url)
    if not ok:
        _logger.error(
            json.dumps(
                {
                    "event": "cocoindex.url_ssrf_rejected",
                    "op_id": str(op_id),
                    "source_url": item.url,
                    "reason": reason,
                }
            )
        )
        await _log_ssrf_rejection(
            source_url=item.url,
            reason=reason or "",
            op_id=op_id,
            ledger_urls=item.ledger_urls,
        )
        return  # ZERO rows — siblings unaffected (BI-21)

    # ── Step 2: PDF sniff (D-12) + fetch ─────────────────────────────────────
    pullmd_share_id: str | None = None
    if await _url_is_pdf(item.url):
        # PDF route (BI-20): SSRF-validated GET → Docling. Never PullMD.
        pdf_bytes = await _fetch_url_bytes(item.url)
        markdown = await _docling_to_markdown(pdf_bytes, _url_filename(item.url))
        extraction_method: str | None = "docling"
        mime_type = "application/pdf"
        file_size = len(pdf_bytes)
        content_hash = hashlib.sha256(pdf_bytes).hexdigest()
    else:
        # HTML route (ID-112.7, PI-1): SSRF-validated GET → in-process
        # Trafilatura clean ({112.5} `clean_html`) → content-length gate. The
        # PullMD fetch+extract hop is RETIRED here — `_fetch_url_bytes` reuses
        # the SAME SSRF-validated GET as the PDF branch (step 1's `validate_url`
        # already gated this URL for every route), so no new SSRF surface is
        # introduced; the cleaner is a pure HTML→text function (no fetch).
        html_bytes = await _fetch_url_bytes(item.url)
        # Decode bytes→str robustly: a naive utf-8 decode mangles legacy-encoded
        # pages. `charset_normalizer` (a Trafilatura dependency) sniffs the
        # encoding; if it finds none, fall back to utf-8 with replacement so a
        # short/garbled page degrades into the REJECT gate rather than raising.
        best = charset_normalizer.from_bytes(html_bytes).best()
        raw_html = (
            str(best)
            if best is not None
            else html_bytes.decode("utf-8", errors="replace")
        )
        cleaned = clean_html(raw_html, url=item.url)
        gate = apply_quality_gate(cleaned)
        if gate.verdict is GateVerdict.REJECT:
            # PI-5 / BI-19: too-short extraction is a per-item failure. Mirror
            # the step-1 SSRF rejection shape — a structured error log then a
            # `return` BEFORE any `declare_row`, so ZERO partial rows land and
            # the next walk re-runs the item (memo miss on a failure-aborted
            # run). Siblings are unaffected.
            _logger.error(
                json.dumps(
                    {
                        "event": "cocoindex.url_extraction_rejected",
                        "op_id": str(op_id),
                        "source_url": item.url,
                        "cleaned_length": len(cleaned),
                    }
                )
            )
            return  # ZERO rows — siblings unaffected (BI-19)
        if gate.verdict is GateVerdict.WARN:
            # PI-5: limited content — surface a structured warning and PROCEED
            # (the row still lands; the manual route's parity is a warning, not
            # a rejection, below the 500-char threshold).
            _logger.warning(
                json.dumps(
                    {
                        "event": "cocoindex.url_extraction_warning",
                        "op_id": str(op_id),
                        "source_url": item.url,
                        "cleaned_length": len(cleaned),
                        "warning": gate.warning,
                    }
                )
            )
        # The downstream variable stays `markdown` but now holds clean TEXT —
        # clean text is exactly what feeds classification, embedding, and the
        # `reference_items.body` write (Markdown was never load-bearing on the
        # URL path; PI-1). `pullmd_share_id` stays None (in-house extractor, no
        # share id; the column is nullable).
        markdown = cleaned
        extraction_method = "trafilatura"
        mime_type = "text/html"
        encoded = markdown.encode()
        file_size = len(encoded)
        content_hash = hashlib.sha256(encoded).hexdigest()
    # Inv-17: one binary→markdown conversion completed for this item.
    _bump("binary_conversion")

    # ── Step 3: classification + embedding ───────────────────────────────────
    # content_type output is DISCARDED (D-10 — references carry no
    # content_type; the closed enum is preserved, BI-22 corollary 1).
    classification = await extract_classification(markdown)
    _bump("llm_extraction")
    embedding = await embed_content_text(markdown)
    _bump("embedding")

    # ── Step 4: deterministic PKs — a content_items seed is NEVER minted from
    # a URL (BI-1/BI-2: re-landing the same URL UPSERTs the same sd+ri pair).
    source_document_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"sd:{item.url}")
    reference_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ri:{item.url}")

    # ── Step 5: source_documents row (BI-4) ──────────────────────────────────
    sd_target.declare_row(
        row={
            "id": source_document_id,
            # storage_path = source_url = normalised URL (RESEARCH constraint 2)
            "storage_path": item.url,
            "source_url": item.url,
            "filename": _url_filename(item.url),
            "mime_type": mime_type,
            "file_size": file_size,
            "content_hash": content_hash,
            "op_id": op_id,
            "extraction_method": extraction_method,
            "pullmd_share_id": pullmd_share_id,
        }
    )
    _bump("postgres_upsert")  # Inv-17: source_documents row upsert

    # ── Step 6: reference_items row (the full BI-3 contract) ─────────────────
    ri_target.declare_row(
        row={
            "id": reference_item_id,
            # Ledger title (feed-declared) with classifier suggested_title
            # fallback if ever empty (D-10).
            "title": item.title or _field(classification, "suggested_title"),
            "body": markdown,
            "summary": item.summary,
            "source_url": item.url,
            # Original publication time, never ingest time (BI-3). asyncpg
            # needs a datetime for timestamptz; the item carries ISO 8601.
            "published_at": (
                datetime.fromisoformat(item.published_at)
                if item.published_at
                else None
            ),
            "primary_domain": _field(classification, "primary_domain"),
            "primary_subtopic": _field(classification, "primary_subtopic"),
            "layer": "research",  # v1 constant (D-10)
            "embedding": embedding,
            "source_document_id": source_document_id,
            "ingestion_source": item.ingestion_source,
            "op_id": op_id,
            # workspace_ids NEVER written (BI-7); created_at/updated_at
            # PG-defaulted — omitted per convention.
        }
    )
    _bump("postgres_upsert")  # Inv-17: reference_items row upsert

    # ── Step 7: D-7 backlink — all N ledger rows → the one reference ─────────
    # {75.17} FK-tolerant walk-1 write (S319 live discovery): this UPDATE runs
    # IN-component, but the engine flushes the `ri_target` row declared at
    # step 6 only AFTER the component returns (cocoindex-write-model.md §1 —
    # no per-row UPSERT completion callback), so on a clean first walk the
    # `feed_articles_reference_item_id_fkey` FK CANNOT yet be satisfied.
    # Tolerate EXACTLY that violation: log a structured deferral and let the
    # item COMPLETE — a raise would route into the BI-19 per-item containment,
    # whose faulted-item contract DISCARDS the declared sd/ri rows ({75.16}
    # probe), so every subsequent walk would re-hit the same race (zero
    # convergence — the S319 defect). Walk 2 re-runs this component (the
    # per-walk `flow_op_id` kwarg busts the `@coco.fn(memo=True)` fingerprint
    # — real-engine probed at {75.17}; `_pullmd_fetch`'s own (url, epoch) memo
    # keeps the re-run cheap) and the backlink then lands against the ri row
    # flushed at the end of walk 1. ANY other error — including a
    # ForeignKeyViolation on a DIFFERENT constraint — still raises into the
    # containment tally.
    try:
        await _backlink_feed_articles(reference_item_id, item.ledger_urls)
    except Exception as exc:  # noqa: BLE001 — narrowed immediately below
        # Narrow on the postgres constraint NAME alone ({75.17} Checker fix):
        # only postgres FK violations carry a `constraint_name` attribute
        # (asyncpg surfaces the server diag field — the real-asyncpg seam is
        # pinned by test_real_asyncpg_fk_violation_exposes_constraint_name),
        # so the string compare preserves the semantic narrowing WITHOUT
        # depending on the asyncpg exception-class OBJECT — whose identity is
        # import-order-dependent under the unit suites' MagicMock asyncpg
        # stubs (a class-based isinstance narrowing proved run-order-flaky).
        if getattr(exc, "constraint_name", None) != _FEED_ARTICLES_RI_FKEY:
            raise
        _logger.info(
            json.dumps(
                {
                    "event": "cocoindex.url_backlink_deferred",
                    "op_id": str(op_id),
                    "source_url": item.url,
                    "reference_item_id": str(reference_item_id),
                }
            )
        )


async def _ingest_form_branch(
    file: "coco.resources.file.FileLike",  # type: ignore[name-defined]
    rel_path: str,
    ft_target: Any,
    ftf_target: Any,
    *,
    op_id: "uuid.UUID",
    _bump: Any,
    resolution: Resolution,
) -> None:
    """Path-B form branch — pipeline-owned form-template write (ID-80.8, 80.2 §B.3).

    Touches ONLY `ft_target` / `ftf_target` — it NEVER touches the ci/qa/sd/
    em/cc targets. Reached EXCLUSIVELY via the `_ingest_file_body` fork when
    the manifest tags the file's prefix `route:"forms"`, so workspace
    resolution has already happened ONCE at the fork — `resolution` carries
    the winning workspace; the manifest-presence gate and the duplicated
    resolve call this branch used to own are gone (ID-80.8). Keeps,
    unchanged: the `extract_form_structure` raw-bytes call, the
    `FormExtractionError` → `analysis_failed` row, the Inv-17 graceful-empty
    path, and the `_trim_stale_form_fields` trim. `_bump` is the dispatcher's
    stage-counter closure, threaded through unchanged.

    The forms route performs NO Stage-2 Markdown conversion and NO Anthropic
    extraction passes — `extract_form_structure` reads the raw native bytes
    (the Markdown run for forms was Path-A waste the fork eliminated).
    RATIFIED OQ-80.2-A (Liam, S314, 05/06/2026): forms land ZERO content rows
    (no content_items / source_documents / content_chunks / q_a_extractions /
    entity_mentions); the minimal-provenance-row fallback is DROPPED. CAVEAT:
    only BLANK form instruments route here (ID-52 Mode-3) — ANSWERED/completed
    forms are knowledge containers and stay on the content branch via
    `route:"content"` folder placement (the folder contract carries the
    distinction; the suffix guard below is the loud backstop for mis-wires).
    """
    # ── ID-52 Path B: pipeline-owned form-template write (TECH §2.5) ─────────
    # ID-69 / {66.22} (S297) — architectural boundary: the content branch's
    # targets (content_items / source_documents / content_chunks /
    # q_a_extractions / entity_mentions) are the CANONICAL, workspace-AGNOSTIC
    # record layer. `content_items` has no workspace_id (ID-69 BI-1), and the
    # `content_item_workspaces` M2M junction is DELIBERATELY not populated
    # here: association is ID-69's job (operator-side in v1 via
    # `app/api/items/[id]/workspaces`; ingest-side extended manifest in v1.1).
    # Only this Path-B form-write consumes a workspace_id (forms ARE
    # workspace-scoped) — it arrives via `resolution` from the fork.
    workspace_id = resolution.workspace_id

    suffix = file.file_path.path.suffix.lower()

    # The SAME deterministic per-document uuid5 the content branch seeds (a
    # pure function of rel_path — no clock, no I/O), recomputed here ONLY for
    # error-log attribution (the suffix-guard and FormExtractionError
    # stage_error events below). No form-branch row write uses it, so the two
    # branches stay decoupled.
    content_item_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ci:{rel_path}")

    # ── Secondary suffix guard (ID-80.8, 80.2 §B.3 candidate 5) ─────────────
    # A non-form suffix (.md/.txt/.html) under a `route:"forms"` prefix is a
    # manifest mis-wire (content placed in a forms folder, or a mis-tagged
    # prefix) → surface LOUDLY, mirroring the AmbiguousResolution treatment at
    # the fork: one `cocoindex.stage_error` + ZERO rows. This catches operator
    # error early rather than silently producing an `analysis_failed` row.
    if suffix in _NON_FORM_SUFFIXES:
        _emit_stage_error_log(
            op_id=op_id,
            stage="workspace_resolution",
            error_class="extraction_validation_failed",
            content_items_id=content_item_id,
            error_message=(
                f"manifest mis-wire: non-form suffix {suffix!r} under a "
                f"route:'forms' prefix (rel_path={rel_path!r}) — content files "
                "belong under a route:'content' prefix (80.2 §B.3)"
            ),
        )
        return

    # TECH §2.5 step 2: deterministic structural extraction (Path B, NO LLM).
    # `extract_form_structure` returns None for non-form / out-of-scope `.xls`
    # (the latter already emits its own `form_extractor.skip` log — Inv-3); it
    # raises FormExtractionError on an unreadable form (Inv-17). The whole call
    # is wrapped per-file so one form's failure never halts the batch.
    # ID-80.13 (D2): a memo HIT arrives as a plain dict (cocoindex resolves the
    # memoised return hint to `Any` — see the orchestrator module docstring),
    # so EVERY return is normalised through `coerce_extracted_form` before the
    # typed attribute accesses below. Without this, walk-2's memo HIT raised
    # AttributeError at `extracted.form_metadata` and reconciliation
    # garbage-collected walk-1's ft/ftf rows (S316 B1 staging smoke).
    form_template_id = uuid.uuid5(_KH_PIPELINE_DOC_NS, f"ft:{rel_path}")
    try:
        extracted = coerce_extracted_form(await extract_form_structure(file))
    except FormExtractionError as exc:
        # Inv-17: workspace resolved, but the reader failed. Record ONE
        # form_templates row with status='analysis_failed' and ZERO fields so
        # the failure is visible; `form_metadata` is unavailable on this path,
        # so the NOT-NULL columns are populated from the File. Same `ft:` UUID5
        # so a later successful re-ingest UPSERTs this same row. Continue the
        # batch (the per-file try/except above scopes the failure).
        _emit_stage_error_log(
            op_id=op_id,
            stage="form_extraction",
            error_class="extraction_validation_failed",
            content_items_id=content_item_id,
            error_message=str(exc),
        )
        ft_target.declare_row(
            row={
                "id": form_template_id,
                "workspace_id": workspace_id,
                "created_by": SERVICE_ACCOUNT_UUID,
                "name": file.file_path.path.stem,
                "filename": file.file_path.path.name,
                "file_size": await file.size(),
                "mime_type": MIME_BY_SUFFIX[suffix],
                "storage_path": rel_path,
                "structure_path": None,
                "description": None,
                "field_count": 0,
                "mapped_count": 0,
                "status": "analysis_failed",
                "ingest_source": "pipeline",
                "form_type": None,
                "deadline": None,
                "issuing_organisation": None,
                "evaluation_methodology": None,
            }
        )
        _bump("postgres_upsert")  # Inv-17: form_templates row upsert (analysis_failed)
        return

    if extracted is None:
        # Not a form-bearing file (or out-of-scope .xls already logged) —
        # graceful fall-through: leave the form targets untouched and continue
        # the batch (no content rows either — OQ-80.2-A zero-content-rows).
        return

    # TECH §2.5 step 3: declare the form_templates instance row (status
    # 'analysed'). The M1b dedicated metadata columns are written from day one.
    form_metadata = extracted.form_metadata

    # PRODUCT Inv-17 (graceful-empty-with-recorded-reason, ratified S278). A
    # structurally readable form that yields ZERO fields (e.g. an XLSX whose
    # sheets matched no archetype — see xlsx.py NO_ARCHETYPE_REASON) is
    # GRACEFUL: it STAYS `status='analysed'` (distinct from the
    # `analysis_failed` strict-raise path above). But it MUST NOT be left as an
    # `analysed`/0-field row with no recorded reason — the exact shape Inv-17
    # forbids. So when the reader returned zero fields we (a) thread a recorded
    # reason onto the row provenance (`description`) and (b) emit a structured
    # log so the empty extraction is surfaced, not silent.
    field_count = len(extracted.fields)
    description = form_metadata.evaluation_methodology
    if field_count == 0:
        graceful_empty_reason = (
            f"{FORM_WRITE_GRACEFUL_EMPTY_REASON}: a structurally readable "
            f"{form_metadata.form_format} form yielded zero extractable fields "
            "(no archetype matched). Inv-17 graceful-empty (S278): the form is "
            "recorded as analysed with a surfaced reason rather than left "
            "silently empty."
        )
        # Preserve any authored description; otherwise the recorded reason is
        # the row's description so the WHY is never lost.
        description = description or graceful_empty_reason
        _logger.info(
            json.dumps(
                {
                    "event": "form_write.graceful_empty",
                    "reason": FORM_WRITE_GRACEFUL_EMPTY_REASON,
                    "rel_path": rel_path,
                    "form_format": form_metadata.form_format,
                    "form_template_id": str(form_template_id),
                    "field_count": 0,
                    "status": "analysed",
                }
            )
        )
    ft_target.declare_row(
        row={
            "id": form_template_id,
            "workspace_id": workspace_id,
            "created_by": SERVICE_ACCOUNT_UUID,
            "name": form_metadata.form_title or file.file_path.path.stem,
            "filename": file.file_path.path.name,
            "file_size": await file.size(),
            "mime_type": MIME_BY_SUFFIX[suffix],
            "storage_path": rel_path,
            "structure_path": None,  # populated by Path C later
            "description": description,
            "field_count": field_count,
            "mapped_count": 0,
            "status": "analysed",
            "ingest_source": "pipeline",
            "form_type": form_metadata.form_type,
            "deadline": form_metadata.deadline,
            "issuing_organisation": form_metadata.issuing_organisation,
            "evaluation_methodology": form_metadata.evaluation_methodology,
        }
    )
    _bump("postgres_upsert")  # Inv-17: form_templates row upsert (analysed)

    # TECH §2.8 (Inv-16 shrink): trim stale field rows from a previous LARGER
    # ingest BEFORE declaring the new field rows. A second ingest that produces
    # fewer fields would otherwise leave the trailing rows stranded with stale
    # data. Gated on the per-document template_id; the DELETE is a no-op on a
    # first ingest. The trim is factored into a helper so it is observable in
    # unit tests without a live asyncpg pool.
    new_max_sequence = (
        max(field.sequence for field in extracted.fields)
        if extracted.fields
        else -1
    )
    await _trim_stale_form_fields(form_template_id, new_max_sequence)

    # TECH §2.5 step 4: declare each extracted field as a form_template_fields
    # row. The PK is deterministic per (form, reading-order sequence) so a
    # re-ingest UPSERTs the same row (Inv-16). `question_id` (Path-C link-back)
    # and `mapping_status` (DB default) are intentionally NOT set here.
    for field in extracted.fields:
        ftf_target.declare_row(
            row={
                "id": uuid.uuid5(
                    _KH_PIPELINE_DOC_NS, f"ftf:{rel_path}:{field.sequence}"
                ),
                "template_id": form_template_id,
                "question_text": field.question_text,
                "placeholder_text": field.placeholder_text,
                "field_type": field.field_type,
                "fill_status": field.fill_status,
                "row_index": field.row_index,
                "col_index": field.col_index,
                "table_index": field.table_index,
                "section_name": field.section_name,
                "sequence": field.sequence,
                "word_limit": field.word_limit,
                "is_mandatory": field.is_mandatory,
                "reference_urls": field.reference_urls,
            }
        )
        _bump("postgres_upsert")  # Inv-17: one form_template_fields row upsert


async def _trim_stale_form_fields(
    form_template_id: uuid.UUID, new_max_sequence: int
) -> None:
    """Delete `form_template_fields` rows beyond `new_max_sequence` (Inv-16).

    Inv-16 shrink case (TECH §2.8): a form revised to drop trailing questions
    would otherwise leave the higher-`sequence` rows stranded. Before the new
    field rows are declared, remove any rows for this template whose `sequence`
    exceeds the current maximum. Implemented as a single asyncpg statement
    against the env-scope `DB_CTX` pool (the same pool the row-level targets use
    under `managed_by=ManagedBy.USER`); declare_row UPSERTs cover the
    add/change cases, so only the shrink case needs an explicit DELETE.

    Factored into a module-level coroutine (rather than inlined) so unit tests
    can observe the trim contract by patching this seam — the live DELETE needs
    a real pool, but the "trim runs before field declares, keyed on
    `(template_id, sequence)`" contract is provable without one.
    """
    pool = coco.use_context(DB_CTX)
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM public.form_template_fields "
            "WHERE template_id = $1 AND sequence > $2",
            form_template_id,
            new_max_sequence,
        )


# ── Main pipeline function ───────────────────────────────────────────────────


async def app_main() -> None:
    """Canonical 6-stage cocoindex pipeline — main_fn for KH_PIPELINE_APP.

    Called by cocoindex's App update cycle. Six stages wired flow-scope
    (NOT @coco.fn-wrapped per cocoindex-extraction-contract TECH §3.1 B-3).

    O-Q8 idle-mode: if COCOINDEX_SOURCE_PATH is unset or points at a
    missing folder, logs an info message and returns cleanly (no raise).
    The Cloud Run Service stays running; cocoindex's live-fs-watch arms
    once the source-binding is set. The T7 first-ingest cutover sets
    COCOINDEX_SOURCE_PATH and restarts the Service post-T8-stable.
    """
    source_path_str = os.environ.get("COCOINDEX_SOURCE_PATH", "")
    if not source_path_str:
        _logger.info(
            "COCOINDEX_SOURCE_PATH not set — Service running in idle mode. "
            "Set COCOINDEX_SOURCE_PATH and restart Service when ready to "
            "stage files (T7 first-ingest cutover)."
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
    # Inv-7 taxonomy-miss substrate: counter is bound via
    # `bind_taxonomy_miss_counter` below so the
    # `_surface_out_of_taxonomy_classification` model-validator in
    # `extraction.py` records each out-of-taxonomy primary_domain /
    # primary_subtopic / secondary_classification value (soft-warn — the row is
    # written unchanged). Its per-field tally is folded into the flow-end
    # webhook payload (ID-63.8).
    flow_taxonomy_miss_counter = _FlowTaxonomyMissCounter()
    # 80.2 §B.4 per-item-failure substrate (ID-80.9): bumped by the
    # containment handler in `bound_ingest_file` below each time an
    # unexpected exception escapes ONE file's ingest; its per-branch tally
    # (`{'forms': n, 'content': m}`) is threaded into the terminal webhook
    # emit. Per-item faults never flip `flow_status` (OQ-80.2-C).
    flow_item_failure_counter = _FlowItemFailureCounter()

    # ── ID-52 Path B: load the folder→workspace manifest ONCE at flow start ──
    # (TECH §2.1). The manifest lives at the root of the ingest source folder.
    # A missing / unparseable / schema-invalid manifest ABORTS the flow with a
    # structured `manifest_missing` / `manifest_invalid` stage error (the form
    # path must not run without a workspace map). The loaded manifest is bound
    # at flow scope (around `mount_each` below) so the per-item `ingest_file`
    # reaches it via `current_workspace_manifest()`.
    manifest_path = source_path / _WORKSPACE_MANIFEST_FILENAME
    try:
        workspace_manifest = load_workspace_manifest(manifest_path)
    except ManifestLoadError as exc:
        manifest_stage = (
            "manifest_missing" if not manifest_path.exists() else "manifest_invalid"
        )
        _emit_stage_error_log(
            op_id=run_op_id,
            stage=manifest_stage,
            error_class="extraction_validation_failed",
            content_items_id=None,
            error_message=str(exc),
        )
        await _emit_pipeline_run_webhook(
            op_id=run_op_id,
            status="failed",
            stage_counts=stage_counts,
            items_processed=0,
            items_created=[],
            extractor_version=extractor_version,
            error_message=_redact_error_message(str(exc)),
            error_class="extraction_validation_failed",
        )
        raise

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
    # bl-165 Option B (ID-61.4): fine-grained Pydantic detail — populated
    # only when the captured exception is a pydantic ValidationError.
    flow_error_detail: dict[str, str] | None = None

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
        # ID-101 §{101.7} (Inv-6, PC-3 lane). Stage-5 relationship writes land
        # here; the per-doc declare loop that consumes `er_target` runs inside
        # `_ingest_content_branch` (the {101.7} write site). managed_by=USER:
        # cocoindex UPSERTs rows only — the entity_relationships table already
        # exists on staging; NO DDL here (RULING 2 — no op_id migration).
        er_target = await mount_table_target(
            DB_CTX,
            "entity_relationships",
            ENTITY_RELATIONSHIPS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        # ID-52.12 (Inv-6). Path-B pipeline-owned form-template write targets.
        # managed_by=ManagedBy.USER: cocoindex UPSERTs rows only — the tables +
        # all columns already exist on staging (Migrations M1/M1b); NO DDL here.
        ft_target = await mount_table_target(
            DB_CTX,
            "form_templates",
            FORM_TEMPLATES_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        ftf_target = await mount_table_target(
            DB_CTX,
            "form_template_fields",
            FORM_TEMPLATE_FIELDS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        # ID-56.8 (PRODUCT C-10..C-13). content_chunks chunk-row UPSERT target.
        # managed_by=ManagedBy.USER: cocoindex UPSERTs rows only — the table +
        # the {56.6} op_id column already exist on staging; NO DDL here.
        cc_target = await mount_table_target(
            DB_CTX,
            "content_chunks",
            CONTENT_CHUNKS_SCHEMA,
            managed_by=ManagedBy.USER,
        )
        # ID-75.11 (TECH §3 WP-C). reference_items — the URL source's Layer-5
        # write target (BI-3). managed_by=ManagedBy.USER: rows only, never DDL
        # — the table + UNIQUE(source_url) shipped in Migration M1 (WP-A).
        ri_target = await mount_table_target(
            DB_CTX,
            "reference_items",
            REFERENCE_ITEMS_SCHEMA,
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
        # ID-66.19 — thread the run context onto `ingest_file` as EXPLICIT
        # keyword args via a named closure (NOT `contextvars`; and NOT
        # `functools.partial` — see the {66.16} note below). cocoindex
        # 1.0.3 does NOT run the per-item component inline on this binding
        # asyncio task — it schedules it on its OWN `_LoopRunner` daemon thread
        # (a separate event loop) which does NOT copy this task's `ContextVar`
        # snapshot across the dispatch boundary. So the previous five
        # `async with bind_*` CMs wrapping `mount_each` bound the context on the
        # WRONG thread: inside `ingest_file` every `current_*()` read returned
        # the ContextVar default (None) → `current_flow_meta()` None → 0 rows;
        # `current_workspace_manifest()` None → the Path-B form-write skipped;
        # `current_stage_counter()` None → stage_counts stuck at 0. This was
        # invisible to the unit suite (every flow test mocks `mount_each`, so
        # `ingest_file` ran inline on the test's own task with ContextVars
        # intact); the engine-level daemon-thread dispatch was exercised by NO
        # test until `test_cocoindex_flow_live_ingest.py` (S291).
        #
        # `functools.partial` is INCOMPATIBLE with cocoindex 1.0.3 `mount_each`:
        # the engine derives the per-item ComponentSubpath from `Symbol(fn.__name__)`
        # AND builds `core.ComponentProcessorInfo(fn.__qualname__)` (function.py:2031)
        # — a partial has NEITHER attribute, so it crashed the `_LoopRunner` worker
        # thread at live boot (first a TypeError on `__name__`, then deeper an
        # AttributeError on `__qualname__`). Both surfaced at the {66.16} on-prem
        # boundary, NOT the unit suite — whose `mount_each` stub modelled the
        # daemon-thread dispatch but not these attribute contracts.
        #
        # Use a NAMED nested coroutine instead: it has a real `__name__` +
        # `__qualname__` + a clean signature, and its CLOSURE CELLS carry the run
        # context (op_id / counters / manifest) across the daemon-thread boundary
        # exactly as the partial's captured args did — so Option A still holds: the
        # BIND POINT stays inside the per-item callable (flow_meta / retry_counter /
        # taxonomy_miss_counter are RE-BOUND locally on the worker thread, where
        # `extraction.py` reads those ContextVars in-task; stage_counter +
        # workspace_manifest are read directly from the passed args), NOT on this
        # binder task whose ContextVars the engine does not propagate.
        # ID-80.9 (80.2 §B.4): per-item containment at the mount_each
        # boundary. An UNEXPECTED escape from one file's branch is contained
        # and attributed (per-branch tally + ingest_item stage error), NOT
        # promoted to a whole-walk failure — Inv-17: one file's fault must
        # not abort the batch or flip flow_status (the bl-224 cascade
        # inversion). Walk-wide faults (manifest load, Stage-5, mount
        # errors) still propagate through the flow-scope except below and
        # correctly land status='failed'.
        async def bound_ingest_file(file, *targets):
            try:
                return await ingest_file(
                    file,
                    *targets,
                    flow_op_id=run_op_id,
                    flow_stage_counter=flow_stage_counter,
                    flow_retry_counter=flow_retry_counter,
                    flow_taxonomy_miss_counter=flow_taxonomy_miss_counter,
                    flow_workspace_manifest=workspace_manifest,
                    flow_source_path=source_path,
                )
            except Exception as exc:  # noqa: BLE001 — per-item containment
                flow_item_failure_counter.increment(
                    _item_failure_branch(workspace_manifest, file, source_path)
                )
                _emit_stage_error_log(
                    op_id=run_op_id,
                    stage="ingest_item",
                    error_class=_classify_stage_exception(exc)
                    or type(exc).__name__,
                    content_items_id=None,
                    error_message=_redact_error_message(str(exc)),
                )
                return None  # swallow → batch continues (80.2 §B.4)

        # Pin the subpath explicitly to "ingest_file" (the pre-{66.19} component
        # identity) — the named coroutine would otherwise auto-derive the subpath to
        # "bound_ingest_file" from its `__name__`.
        handle = await coco.mount_each(
            coco.component_subpath("ingest_file"),
            bound_ingest_file,
            source.items(),
            ci_target,
            qa_target,
            sd_target,
            em_target,
            ft_target,
            ftf_target,
            cc_target,
            er_target,
        )
        # Wait until every per-item component has processed (cold run) so the
        # rollup webhook below reflects a settled state.
        await handle.ready()

        # ── Stage 1b: URL source walk ({75.11} — TECH §3 WP-C wiring) ──────
        # Second Stage-1 source: the passed-URL ledger (`feed_articles WHERE
        # passed = true`), enumerated one item per normalised URL (BI-8) by
        # `FeedUrlSource` over the SAME env-scope asyncpg pool the
        # `mount_table_target(DB_CTX, ...)` calls above resolve (28.22 — no
        # second pool). KNOWN ACCEPTED GAP (TECH §8): the idle-mode gate at
        # the top of app_main (COCOINDEX_SOURCE_PATH unset/missing → early
        # return) also skips this URL enumeration; deployed workers always
        # mount the corpus, so v1 accepts it — do NOT split the gate.
        url_source = FeedUrlSource(pool=coco.use_context(DB_CTX))

        # ID-66.19 named-closure discipline, verbatim from bound_ingest_file
        # above: `functools.partial` is PROHIBITED (the engine derives the
        # ComponentSubpath from `fn.__name__` AND builds
        # `ComponentProcessorInfo(fn.__qualname__)` — a partial has neither
        # and crashes the `_LoopRunner` worker at live boot, {66.16}). The
        # closure cells carry the run context (op_id / counters) across the
        # daemon-thread dispatch boundary; `ingest_url` RE-BINDS the
        # ContextVars locally on the worker thread.
        #
        # BI-19 per-item containment at the mount boundary (the ID-80.9
        # pattern at bound_ingest_file): an UNEXPECTED escape from one URL's
        # ingest is tallied on the 'url' branch + attributed via an
        # ingest_item stage error, NEVER promoted to a whole-walk failure.
        # A failed item declared NOTHING (declare_row runs only after fetch +
        # extraction succeed — see _ingest_url_body ORDERING), so the next
        # walk's enumeration re-runs it: log + skip + retry-on-a-later-walk.
        async def bound_ingest_url(item, *targets):
            try:
                return await ingest_url(
                    item,
                    *targets,
                    flow_op_id=run_op_id,
                    flow_stage_counter=flow_stage_counter,
                    flow_retry_counter=flow_retry_counter,
                    flow_taxonomy_miss_counter=flow_taxonomy_miss_counter,
                )
            except Exception as exc:  # noqa: BLE001 — per-item containment
                flow_item_failure_counter.increment("url")
                _emit_stage_error_log(
                    op_id=run_op_id,
                    stage="ingest_item",
                    error_class=_classify_stage_exception(exc)
                    or type(exc).__name__,
                    content_items_id=None,
                    error_message=_redact_error_message(str(exc)),
                )
                return None  # swallow → batch continues (BI-19)

        # Pin the subpath explicitly to "ingest_url" (the component identity)
        # — the named coroutine would otherwise auto-derive the subpath to
        # "bound_ingest_url" from its `__name__`. `ingest_url` declares ONLY
        # the sd+ri pair (no ci_target in its signature — BI-1 structural
        # impossibility of a content_items write from a URL).
        url_handle = await coco.mount_each(
            coco.component_subpath("ingest_url"),
            bound_ingest_url,
            url_source.items(),
            ri_target,
            sd_target,
        )
        await url_handle.ready()

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

        # ── Stage 5: entity resolution — flow-scope post-fan-out (ID-53) ──
        # Op-scope cross-document canonicalisation. Reads the run's
        # entity_mentions rows (per-doc canonicals written by the per-item
        # phase via the §P-3 declare_row site at {53.11}), invokes
        # cocoindex.ops.entity_resolution.resolve_entities over them with the
        # KH entity embedder (§P-7) + KH PairResolver (§P-8), and UPDATEs rows
        # whose canonical_name resolves to a different cross-document value.
        # Strictly op_id-scoped per Inv-5 — the post-pass NEVER touches rows
        # from prior runs or NULL-op_id rows (app-side writes).
        #
        # PRODUCT.md §2 Area A (Inv-1, Inv-2) — Option B ratification.
        #
        # meta: the §P-1 spec sketch read `current_flow_meta()` here, but the
        # `bind_flow_meta` scope CLOSES at `handle.ready()` above — so
        # `current_flow_meta()` yields None at this point. _run_stage_5_resolution
        # only reads `meta.op_id`, so we construct a FlowRunMeta from the local
        # `run_op_id` (the same op_id bind_flow_meta used).
        # db_pool: the §P-1 spec sketch called `_resolve_db_pool()` (a fictional
        # helper). The asyncpg pool is provisioned env-scope under DB_CTX by
        # `kh_pipeline_lifespan`; `coco.use_context(DB_CTX)` resolves it inside
        # app_main's active component context — the SAME context the
        # `mount_table_target(DB_CTX, ...)` calls above already resolve it from.
        # No second pool is created; the lifespan owns the pool lifecycle.
        # ID-53.15 (T-OQ1): re-wrap any Stage-5 escape as
        # `_EntityResolutionStageError` so `_classify_stage_exception` can
        # attribute it to `entity_resolution_failed` via stage context — the
        # underlying provider exceptions (anthropic / litellm auth errors) are
        # type-indistinguishable from Stage-3 failures (per the {53.14}
        # failure-injection finding). `from exc` preserves `__cause__`. The
        # wrapper still propagates inside the outer try, routing to the
        # `except Exception` rollup handler below.
        try:
            resolved_count = await _run_stage_5_resolution(
                meta=FlowRunMeta(op_id=run_op_id, content_items_id=None),
                db_pool=coco.use_context(DB_CTX),
                flow_stage_counter=flow_stage_counter,
            )
        except Exception as exc:  # noqa: BLE001 — re-wrap for classification
            raise _EntityResolutionStageError(str(exc)) from exc
        _logger.info(
            json.dumps(
                {
                    "event": "cocoindex.stage_5.resolved",
                    "op_id": str(run_op_id),
                    "resolved_count": resolved_count,
                }
            )
        )

        # ── ID-120 §P-3 (INV-1): Q&A dedup PROPOSER post-pass ──────────────
        # Runs AFTER Stage-5 (here), BEFORE the flow-end webhook. Reads the
        # whole published embedding-bearing q_a_pairs corpus (cross-workspace /
        # cross-form, INV-2/6/7), computes cosine candidate pairs in SQL
        # (INV-3/21), and UPSERTs pending proposals to q_a_pair_dedup_proposals
        # (INV-4). Service-role asyncpg pool (the SAME env-scope DB_CTX pool
        # Stage-5 uses); NEVER writes q_a_pairs publication_status/superseded_by
        # (the merge fires only on curator approval, app-side {120.7}).
        #
        # CONTAINMENT (INV-1, testStrategy): the inner re-wrap mirrors Stage-5
        # VERBATIM (`raise _QaDedupProposerStageError(str(exc)) from exc`) so
        # `_classify_stage_exception` attributes any escape to
        # `qa_dedup_proposer_failed` via stage context. But UNLIKE Stage-5, the
        # proposer is a CONTAINED post-pass: the primary ingest already landed
        # by `handle.ready()`, so a proposer failure MUST NOT abort the walk.
        # The outer `except _QaDedupProposerStageError` therefore classifies +
        # emits the structured stage-error log and SWALLOWS the wrapper (does
        # NOT re-raise) — the walk continues to a successful flow-end webhook.
        try:
            try:
                proposed_count = await _run_qa_dedup_proposer(
                    db_pool=coco.use_context(DB_CTX),
                    flow_stage_counter=flow_stage_counter,
                )
            except Exception as exc:  # noqa: BLE001 — re-wrap for classification
                raise _QaDedupProposerStageError(str(exc)) from exc
            _logger.info(
                json.dumps(
                    {
                        "event": "cocoindex.qa_dedup.proposed",
                        "op_id": str(run_op_id),
                        "proposed_count": proposed_count,
                    }
                )
            )
        except _QaDedupProposerStageError as exc:
            # CONTAINED: classify + emit the stage-error log, then continue the
            # walk (no re-raise). The proposer failure is surfaced on the
            # structured log; the ingest that already landed is not masked.
            _emit_stage_error_log(
                op_id=run_op_id,
                stage="qa_dedup_proposer",
                error_class=_classify_stage_exception(exc)
                or type(exc).__name__,
                content_items_id=None,
                error_message=str(exc),
            )

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
        # PII: redact at capture so BOTH the structured stage-error log AND the
        # terminal `finally` webhook emit a redacted message — closing the latent
        # leak where the terminal webhook wrote `str(exc)` un-redacted (bl-165 /
        # Option D; mirrors the manifest-abort path redaction). The classify call
        # below reads the exception object, not this string, so it is unaffected.
        flow_error_message = _redact_error_message(str(exc))
        # bl-165 Option B (ID-61.4): when the exception is a pydantic
        # ValidationError, additionally capture the fine classify_pydantic_error
        # class for `pipeline_runs.result.error_detail`. The coarse Inv-25
        # class below stays `extraction_validation_failed` — unchanged. The
        # detail carries no message text (PII-safe by construction; see
        # `_pydantic_error_detail`).
        flow_error_detail = _pydantic_error_detail(exc)
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
        # Inv-11: fold the flow-scope entity-resolution counter back into
        # `stage_counts["entity_resolution"]` (mirror of the embedding line).
        # The counter was bumped once per UPDATE-eligible row inside Stage-5;
        # done in `finally` so partial-run failures still report the
        # canonical_name UPDATEs that DID land before the failure.
        stage_counts["entity_resolution"] = flow_stage_counter.get(
            "entity_resolution"
        )
        # Inv-11 (ID-56.8): fold the flow-scope chunking counter back into
        # `stage_counts["chunking"]` (mirror of the embedding / entity_resolution
        # lines). The counter was bumped once per declared content_chunks row
        # inside the chunking block of `ingest_file`; done in `finally` so
        # partial-run failures still report the chunk rows that DID land.
        stage_counts["chunking"] = flow_stage_counter.get("chunking")
        # Inv-17 (ID-55.2): fold the remaining four flow-scope stage counters —
        # bumped per-item inside `ingest_file` via `_bump(...)` under the
        # `bind_stage_counter` scope above — back into `stage_counts`. Before
        # ID-55.2 these read a permanent 0 in production despite real per-item
        # activity (only embedding + entity_resolution were wired). Done in
        # `finally`, mirroring the two folds above, so a partial-run failure
        # still reports the stage outputs that DID land before it.
        stage_counts["source_walk"] = flow_stage_counter.get("source_walk")
        stage_counts["binary_conversion"] = flow_stage_counter.get(
            "binary_conversion"
        )
        stage_counts["llm_extraction"] = flow_stage_counter.get("llm_extraction")
        stage_counts["postgres_upsert"] = flow_stage_counter.get("postgres_upsert")
        # Flow-end emission (Inv-16 terminal row). `retry_count` reflects
        # real retry activity via the `bind_retry_counter` scope above.
        #
        # `items_processed` = source files walked + handed to `ingest_file`
        # (one `_bump("source_walk")` per item) — the intuitive "documents
        # processed" count. ID-55.2 deliberately moves OFF the prior
        # `sum(stage_counts.values())`: now that all six stages carry real
        # per-item counts, that sum would inflate ~6x (source_walk +
        # binary_conversion + 3x llm_extraction + embedding + N postgres_upsert
        # per doc) and silently change the magnitude/meaning of the column.
        await _emit_pipeline_run_webhook(
            op_id=run_op_id,
            status=flow_status,
            stage_counts=stage_counts,
            items_processed=stage_counts["source_walk"],
            items_created=items_created,
            error_message=flow_error_message,
            error_class=flow_error_class,
            error_detail=flow_error_detail,
            extractor_version=extractor_version,
            retry_count=flow_retry_counter.get(),
            taxonomy_misses=flow_taxonomy_miss_counter.tally_by_field(),
            # ID-80.9 (80.2 §B.4): per-branch tally of contained per-item
            # faults. Always threaded at flow end — an all-zero map means
            # "walk ran, zero per-item faults" (omitted only at flow start).
            item_failures=flow_item_failure_counter.tally(),
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


async def _register_pg_codecs(conn: "asyncpg.Connection") -> None:  # type: ignore[name-defined]
    """asyncpg pool `init` hook: register a jsonb codec on every connection.

    {66.16}/BUG-D (S297): cocoindex's USER-managed row-upsert path
    (`connectors/postgres/_target.py` `_execute_upsert_chunk`) passes the raw
    declare_row values straight to `conn.execute(sql, *params)` with NO
    per-column encoding (the `ColumnDef.encoder` hook is unset for these columns).
    asyncpg's default jsonb codec then calls `as_pg_string_and_size` on the
    value, which raises `DataError: expected str, got dict` for a Python dict.
    The two jsonb columns the pipeline writes (`entity_mentions.metadata`,
    `q_a_extractions.extraction_metadata`) are dicts. Registering a jsonb codec
    here fixes ALL jsonb columns at the POOL level (current + future) rather than
    relying on per-call-site `json.dumps`. `default=str` mirrors cocoindex's own
    `_json_encoder` so non-JSON-native values (UUID / datetime) serialise rather
    than raising.
    """
    await conn.set_type_codec(
        "jsonb",
        encoder=lambda value: json.dumps(value, default=str),
        decoder=json.loads,
        schema="pg_catalog",
        format="text",
    )


async def _generate_client_alias_snapshot(pool: "asyncpg.Pool") -> None:  # type: ignore[name-defined]
    """Generate the client entity_aliases cache from the live DB at lifespan boot.

    ID-101 {101.10} — fail-closed deploy gate: fetches ALL active entity_aliases
    rows (including ``provenance``) from the DB, checks the fail-closed predicate,
    and primes the canonicaliser cache via ``prime_alias_cache_from_db_rows()``.

    Fail-closed predicate:
      - "configured client" = env ``PIPELINE_CLIENT_ORG`` is set and non-empty.
      - "no alias data" = ZERO rows with ``provenance == 'client'``.
      - configured-client AND zero client rows → ``RuntimeError`` (deploy fails).
      - ``PIPELINE_CLIENT_ORG`` unset/empty → graceful (dev/CI path, no raise).

    DB-free after this single boot fetch: ``prime_alias_cache_from_db_rows()``
    installs the merged map into the module-level cache so subsequent calls to
    ``canonicalise_for_relationship`` read the cache without hitting the DB.
    This is faithful to the {101.9} "DB-free at runtime, snapshot-backed" design
    — the snapshot is the in-memory cache, not a file.

    The existing file-based ``_load_db_entity_aliases()`` /
    ``_ENTITY_ALIASES_SNAPSHOT_PATH`` loader remains as the dev/test fallback when
    this lifespan path does not run (e.g. a fresh checkout with no live pool).

    Separated from the lifespan body to keep testability: pytest can call this
    directly with a fake pool without standing up the full cocoindex lifespan.

    Args:
        pool: An active asyncpg pool connected to the target client DB.

    Raises:
        RuntimeError: When ``PIPELINE_CLIENT_ORG`` is configured (non-empty) and
            the ``entity_aliases`` table contains zero ``provenance='client'`` rows.
            Propagates out of ``kh_pipeline_lifespan`` so Coolify deploy fails
            (fail-closed: we refuse to run with degraded baseline-only
            canonicalisation for a configured client — {101.10}).
    """
    rows = await pool.fetch(
        "SELECT alias, canonical, provenance "
        "FROM public.entity_aliases WHERE is_active = true"
    )

    client_org = os.environ.get(CLIENT_ORG_ENV_VAR, "").strip()
    if client_org:
        client_rows = [r for r in rows if r["provenance"] == "client"]
        if not client_rows:
            raise RuntimeError(
                f"[{CLIENT_ORG_ENV_VAR}={client_org!r}] fail-closed ({'{101.10}'}): "
                "entity_aliases table has zero provenance='client' rows. "
                "Refusing to deploy with baseline-only canonicalisation for a "
                "configured client — alias data is required for correct holder "
                "self-attribution. Populate entity_aliases with client-provenance "
                "rows for this client before deploying."
            )

    prime_alias_cache_from_db_rows(rows)

    counts = {
        "client": sum(1 for r in rows if r["provenance"] == "client"),
        "core": sum(1 for r in rows if r["provenance"] == "core"),
        "recommended": sum(1 for r in rows if r["provenance"] == "recommended"),
        "total": len(rows),
    }
    _logger.info(
        "entity_aliases cache primed at lifespan boot ({101.10}): "
        "total=%d client=%d core=%d recommended=%d configured_client=%r",
        counts["total"],
        counts["client"],
        counts["core"],
        counts["recommended"],
        client_org or None,
    )


@coco.lifespan
async def kh_pipeline_lifespan(builder: coco.EnvironmentBuilder):
    """Provision the asyncpg pool env-scope for the App's lifetime.

    Creates the pool once on environment start, provides it under `DB_CTX` (so
    `mount_table_target` can resolve it), then generates the entity_aliases cache
    ({101.10} fail-closed gate — see ``_generate_client_alias_snapshot``), yields
    for the App lifetime, then closes the pool on teardown.

    The `init` hook registers a jsonb codec on every pooled connection
    ({66.16}/BUG-D) so dict-valued jsonb columns encode correctly.
    """
    pool = await asyncpg.create_pool(
        _build_dsn(), min_size=2, max_size=10, init=_register_pg_codecs
    )
    try:
        builder.provide(DB_CTX, pool)
        await _generate_client_alias_snapshot(pool)
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
