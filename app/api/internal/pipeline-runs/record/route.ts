/**
 * POST /api/internal/pipeline-runs/record — recordPipelineRun() webhook bridge.
 *
 * Bridges the cocoindex Python sidecar (Cloud Run Service) to the TS-side
 * `recordPipelineRun()` helper per TECH.md §P-7 Option α. The sidecar emits
 * twice per flow invocation: `status='in_progress'` at flow start, then one
 * of the three terminal statuses at flow end.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (T-OQ2). Inv-18 discipline:
 * this route is the ONLY path the sidecar uses to land `pipeline_runs` rows
 * (delegates to `recordPipelineRun`, never a raw `.insert`).
 *
 * Proxy: `/api/internal/*` falls under the existing `/api/` bypass in
 * `proxy.ts`; auth is enforced by `verifyCronAuth` below.
 *
 * Reference: docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-7.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { PipelineErrorClassSchema } from '@/lib/pipeline/error-classes';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { parseBody } from '@/lib/validation';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 10;

/**
 * Per-stage row-count vocabulary — seven canonical stages per
 * `02-data-flow.md` §3.1, extended by the ID-56.8 `chunking` stage (the
 * cocoindex RecursiveSplitter chunk-row writer, Inv-11 elevation). All seven
 * MUST be present (even at zero) so `pipeline_runs.result.stage_counts` is
 * consistent across runs (Inv-17). The producer (`_empty_stage_counts()` in
 * `scripts/cocoindex_pipeline/flow.py`) always supplies the full map, so
 * adding the key keeps producer + schema in sync.
 */
const StageCountsSchema = z.object({
  source_walk: z.number().int().nonnegative(),
  binary_conversion: z.number().int().nonnegative(),
  llm_extraction: z.number().int().nonnegative(),
  embedding: z.number().int().nonnegative(),
  entity_resolution: z.number().int().nonnegative(),
  chunking: z.number().int().nonnegative(),
  postgres_upsert: z.number().int().nonnegative(),
});

/**
 * Pipeline-run status — extends `recordPipelineRun`'s native type with
 * `in_progress` for the flow-start row (Inv-16: one row per invocation,
 * including the start row). The helper's Sentry-alerting switch only
 * fires on the three terminal statuses — `in_progress` is silent, which
 * is the desired behaviour for flow-start emissions.
 */
const PipelineStatusSchema = z.enum([
  'in_progress',
  'completed',
  'completed_with_errors',
  'failed',
]);

/**
 * bl-165 Option B (ID-61.4): fine-grained Pydantic error vocabulary —
 * the exact codomain of `classify_pydantic_error()` /
 * `_PYDANTIC_ERROR_TO_ERROR_CLASS` in
 * `scripts/cocoindex_pipeline/extraction.py` (grounded from the source, not
 * the dispatch brief — the brief's `missing_field`/`literal_violation`
 * names exist nowhere in the codebase). Strict enum at the trust boundary
 * (mirrors `PipelineErrorClassSchema`): a drifting sidecar fails with HTTP
 * 400 rather than silently landing an unmapped class string. This is a
 * SUB-classification persisted into `result.error_detail` — the coarse
 * Inv-25 `errorClass` stays the 6-class stage-level vocabulary, unchanged.
 */
const PydanticErrorClassSchema = z.enum([
  'missing_required',
  'invalid_enum',
  'invalid_discriminator',
  'unexpected_field',
  'type_coercion',
]);

const BodySchema = z.object({
  /** cocoindex per-flow op_id — UUID v4 minted at flow construction. */
  opId: z.string().uuid(),
  /** Pipeline identifier — always `kh_canonical_pipeline` from the sidecar. */
  pipelineName: z.string().min(1),
  /** Run status — `in_progress` at flow start, terminal at flow end. */
  status: PipelineStatusSchema,
  /** Total items the pipeline observed. */
  itemsProcessed: z.number().int().nonnegative(),
  /** IDs of `content_items` the pipeline created (empty on memo-hit runs). */
  itemsCreated: z.array(z.string()),
  /** Per-stage counters — all seven stages required (see StageCountsSchema). */
  stageCounts: StageCountsSchema,
  /** Human-readable failure summary (optional; populated on terminal failure). */
  errorMessage: z.string().optional(),
  /**
   * Inv-25 6-class error vocabulary; strict-validated so a drifting sidecar
   * fails with HTTP 400 at the trust boundary rather than silently landing
   * an unknown class. Source: `lib/pipeline/error-classes.ts`.
   */
  errorClass: PipelineErrorClassSchema.optional(),
  /**
   * bl-165 Option B (ID-61.4): fine-grained Pydantic failure detail emitted
   * when a `pydantic.ValidationError` aborts the flow. Inner keys are
   * snake_case because they persist verbatim into
   * `pipeline_runs.result.error_detail`. Carries NO message text (the
   * Option-D PII-redaction surface stays `errorMessage`), so nothing here
   * needs redaction by construction.
   */
  errorDetail: z
    .object({
      pydantic_class: PydanticErrorClassSchema,
      stage: z.string(),
    })
    .optional(),
  /** IMAGE_SHA from Cloud Build — Inv-8 forensic correlation key. */
  extractorVersion: z.string().optional(),
  /**
   * Inv-23 transient-failure observability. Optional for back-compat with
   * pre-28.13 sidecars; non-negative int when present (negative or float
   * indicates a sidecar bug, rejected at the boundary).
   */
  retryCount: z.number().int().nonnegative().optional(),
  /**
   * ID-63.8 Inv-7 (rider on ID-61.4): per-field tally of out-of-taxonomy
   * soft-warns — `_FlowTaxonomyMissCounter.tally_by_field()` in
   * `scripts/cocoindex_pipeline/flow.py` emits `dict[str, int]` as
   * `payload["taxonomyMisses"]` at flow end. Before ID-61.4 this strict
   * schema silently stripped the key, so the tally never reached
   * `pipeline_runs.result` (live Inv-7 regression). Empty map is meaningful:
   * "extractions ran, zero misses" — distinguishable from the field being
   * omitted entirely (flow-start emission).
   */
  taxonomyMisses: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
  /**
   * ID-80.9 (80.2 §B.4, OQ-80.2-C RATIFIED): per-branch tally of CONTAINED
   * per-item ingest faults — `_FlowItemFailureCounter.tally()` in
   * `scripts/cocoindex_pipeline/flow.py` emits `{'forms': n, 'content': m}`
   * as `payload["itemFailures"]` at flow end. Per-item faults ride a
   * `completed` run (status `failed` is reserved for walk-wide faults —
   * the bl-224 cascade inversion). An all-zero tally is meaningful ("walk
   * ran, zero per-item faults") and distinguishable from the field being
   * omitted entirely (flow-start emission / pre-80.9 sidecars). Sibling of
   * ID-61.4's `errorDetail` + `taxonomyMisses` — strictly additive.
   *
   * ID-80.17 ({80.16} rider delta): `url` is the third branch, emitted by
   * `bound_ingest_url` (ID-75.11, the Stage-1b URL-source mount) — counter
   * init is `{'forms': 0, 'content': 0, 'url': 0}`. Optional (unlike its
   * siblings) for wire back-compat: pre-75.11 sidecars emit the two-key
   * `{forms, content}` shape, and the route (Vercel) deploys independently
   * of the pipeline (VPS), so a required `url` would 400 the whole run
   * recording during the align/deploy window — a worse failure than the
   * key-strip this fixes.
   */
  itemFailures: z
    .object({
      forms: z.number().int().nonnegative(),
      content: z.number().int().nonnegative(),
      url: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    logger.warn(
      { err },
      'pipeline-runs/record: malformed JSON body — rejecting',
    );
    return NextResponse.json(
      { error: 'invalid_json', details: safeErrorMessage(err, 'invalid JSON') },
      { status: 400 },
    );
  }

  const parsed = parseBody(BodySchema, rawBody);
  if (!parsed.success) {
    return parsed.response;
  }

  const {
    opId,
    pipelineName,
    status,
    itemsProcessed,
    itemsCreated,
    stageCounts,
    errorMessage,
    errorClass,
    errorDetail,
    extractorVersion,
    retryCount,
    taxonomyMisses,
    itemFailures,
  } = parsed.data;

  // Compose `pipeline_runs.result` (Inv-17 / Inv-8 / Inv-23 envelope).
  // `retry_count` uses `!== undefined` (not truthy) — 0 is meaningful
  // (the no-retry happy path) and must land verbatim.
  const result: Record<string, unknown> = {
    stage_counts: stageCounts,
  };
  if (extractorVersion) result.extractor_version = extractorVersion;
  if (errorClass) result.error_class = errorClass;
  // bl-165 Option B (ID-61.4): fine Pydantic detail lands ALONGSIDE the
  // coarse `error_class` — never in place of it. Key absent when the
  // sidecar omits the field (no `error_detail: undefined` leakage).
  if (errorDetail !== undefined) result.error_detail = errorDetail;
  if (retryCount !== undefined) result.retry_count = retryCount;
  // ID-63.8 Inv-7: `!== undefined` (not truthy) — an empty map means
  // "extractions ran, zero misses" and must land verbatim.
  if (taxonomyMisses !== undefined) result.taxonomy_misses = taxonomyMisses;
  // ID-80.9 (80.2 §B.4): `!== undefined` (not truthy) — an all-zero tally
  // means "walk ran, zero per-item faults" and must land verbatim. Key
  // absent when the sidecar omits the field (no `item_failures: undefined`
  // leakage).
  if (itemFailures !== undefined) result.item_failures = itemFailures;

  try {
    const supabase = createServiceClient();
    // `status` is the Zod-validated `PipelineStatusSchema` enum, structurally
    // identical to `recordPipelineRun`'s `PipelineRunStatus` (both:
    // in_progress | completed | completed_with_errors | failed), so it is
    // passed through directly — no cast needed. (bl-166: the prior
    // `as 'completed' | 'completed_with_errors' | 'failed'` downcast mistyped
    // the flow-start `in_progress` value, narrowing it out of a union it is a
    // valid member of.) The helper's Sentry switch ignores `in_progress`, so
    // flow-start emissions never trigger an alert.
    await recordPipelineRun({
      supabase,
      pipelineName,
      status,
      itemsProcessed,
      itemsCreated,
      opId,
      errorMessage: errorMessage ?? null,
      result: result as Json,
    });
  } catch (err) {
    // `recordPipelineRun` is "never throws" by contract — belt-and-braces
    // guard so the sidecar always gets a clean HTTP response.
    logger.error(
      { err, opId, pipelineName, status },
      'pipeline-runs/record: recordPipelineRun threw unexpectedly',
    );
    return NextResponse.json(
      {
        error: 'record_pipeline_run_failed',
        details: safeErrorMessage(err, 'recordPipelineRun threw'),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
