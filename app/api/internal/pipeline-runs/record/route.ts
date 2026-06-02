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
  /** IMAGE_SHA from Cloud Build — Inv-8 forensic correlation key. */
  extractorVersion: z.string().optional(),
  /**
   * Inv-23 transient-failure observability. Optional for back-compat with
   * pre-28.13 sidecars; non-negative int when present (negative or float
   * indicates a sidecar bug, rejected at the boundary).
   */
  retryCount: z.number().int().nonnegative().optional(),
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
    extractorVersion,
    retryCount,
  } = parsed.data;

  // Compose `pipeline_runs.result` (Inv-17 / Inv-8 / Inv-23 envelope).
  // `retry_count` uses `!== undefined` (not truthy) — 0 is meaningful
  // (the no-retry happy path) and must land verbatim.
  const result: Record<string, unknown> = {
    stage_counts: stageCounts,
  };
  if (extractorVersion) result.extractor_version = extractorVersion;
  if (errorClass) result.error_class = errorClass;
  if (retryCount !== undefined) result.retry_count = retryCount;

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
