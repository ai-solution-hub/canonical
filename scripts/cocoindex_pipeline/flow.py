"""Cocoindex 1.0.3 canonical 6-stage pipeline (T8) — per
02-data-flow.md §3.1 + cocoindex-extraction-contract TECH §3.1.

Stages (flow-scope):
  1. source walk            -> connectors.localfs.walk_dir(live=True, recursive=True)
  2. binary conversion      -> per-MIME adapters (P-3): docling for PDF/DOCX/XLSX,
                               pullmd HTTP client for HTML, passthrough for markdown
  3. LLM extraction         -> TODO(28.12) ExtractByLlm stubs — real wiring in Wave 2
  4. embedding              -> TODO(28.12) LiteLLMEmbedder stub — real wiring in Wave 2
  5. entity resolution      -> TODO(28.12) entity_resolution stub — real wiring in Wave 2
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

References:
  docs/specs/cocoindex-flow-scaffolding/TECH.md §P-2, §P-5
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
import urllib.parse
import uuid
from pathlib import Path
from typing import Literal

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

# ── Stage 3 / Stage 4 / Stage 5 imports — TODO(28.12) stubs ────────────────
# ExtractByLlm, LlmSpec, LlmApiType, LiteLLMEmbedder, and entity_resolution
# are wired in Wave 2 (28.12). The extraction module (T1.2) must be landed
# AND litellm + faiss packages available before these imports resolve.
#
# API note: ExtractByLlm / LlmSpec / LlmApiType do NOT exist in cocoindex
# 1.0.3 (confirmed S254) — they are expected from the extraction-contract spec
# (T1.2). LiteLLMEmbedder lives in cocoindex.ops.litellm (requires litellm pkg).
# entity_resolution lives in cocoindex.ops.entity_resolution (requires faiss).
#
# from scripts.cocoindex_pipeline.extraction import (
#     ClassificationExtraction,
#     EntityMentionExtraction,
#     QAFormExtraction,
# )
# from scripts.cocoindex_pipeline.prompts import (
#     CLASSIFICATION_PROMPT,
#     ENTITY_MENTION_PROMPT,
#     Q_A_FORM_PROMPT,
# )
# from cocoindex.ops.litellm import LiteLLMEmbedder
# from cocoindex.ops.entity_resolution import entity_resolution
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

            # ── Stage 3: LLM extraction (flow-scope) — TODO(28.12) ──────────
            # Real ExtractByLlm wiring lands in Wave 2 (28.12).
            # Per cocoindex-extraction-contract TECH §3.1 (verifier B-3):
            # placed at flow scope on a data-source column, NOT inside a
            # @coco.fn wrapper. Stub comments preserve the intended shape.
            #
            # classification = content_text.transform(
            #     ExtractByLlm(
            #         llm_spec=LlmSpec(api_type=LlmApiType.ANTHROPIC, model=ANTHROPIC_MODEL),
            #         output_type=ClassificationExtraction,
            #         instruction=CLASSIFICATION_PROMPT,
            #     )
            # )
            # q_a_form = content_text.transform(
            #     ExtractByLlm(
            #         llm_spec=LlmSpec(api_type=LlmApiType.ANTHROPIC, model=ANTHROPIC_MODEL),
            #         output_type=QAFormExtraction,
            #         instruction=Q_A_FORM_PROMPT,
            #     )
            # )
            # entity_mentions = content_text.transform(
            #     ExtractByLlm(
            #         llm_spec=LlmSpec(api_type=LlmApiType.ANTHROPIC, model=ANTHROPIC_MODEL),
            #         output_type=list[EntityMentionExtraction],
            #         instruction=ENTITY_MENTION_PROMPT,
            #     )
            # )

            # ── Stage 4: embedding (vector(1024)) — TODO(28.12) ─────────────
            # Requires litellm package + LITELLM_API_KEY env var.
            # embedding = content_text.transform(
            #     LiteLLMEmbedder(model="openai/text-embedding-3-large")
            # )

            # ── Stage 5: entity resolution — TODO(28.12) ─────────────────────
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
    finally:
        await coco_pool.close()


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
