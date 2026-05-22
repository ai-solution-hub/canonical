/**
 * POST /api/internal/pipeline-runs/record — recordPipelineRun() webhook bridge.
 *
 * Subtask ID-28.11 — bridges the cocoindex Python sidecar (Cloud Run Service)
 * to the TS-side `recordPipelineRun()` helper per TECH.md §P-7 Option α
 * (sidecar webhook callback). The cocoindex sidecar emits to this endpoint
 * twice per flow invocation — once at flow start (`status='in_progress'`)
 * and once at flow end (`status='completed'|'completed_with_errors'|'failed'`).
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` (T-OQ2 ratified S252 — reuse
 * the existing cron-handler convention; CRON_SECRET is already mounted in
 * the Cloud Run Service env via Secret Manager per ID-28.6).
 *
 * Inv-18 discipline (per PRODUCT spec): this route is the ONLY path the
 * Python sidecar uses to land `pipeline_runs` rows. The route delegates to
 * `recordPipelineRun()` from `@/lib/pipeline/record-run` — never a raw
 * `supabase.from('pipeline_runs').insert` call (CLAUDE.md "Cron
 * pipeline_runs inserts" gotcha).
 *
 * Proxy: the route lives under `/api/`, which the auth proxy bypasses for
 * redirect-to-login at the per-route level (see `proxy.ts` line 111:
 * `pathname.startsWith('/api/')`). Auth is enforced exclusively via the
 * `verifyCronAuth()` Bearer-token check below. No `publicRoutes` allowlist
 * edit needed — `/api/internal/*` falls under the existing api-route bypass.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §P-7 (Option α)
 *   - docs/reference/task-list.json ID-28.11
 *   - lib/cron-auth.ts (verifyCronAuth)
 *   - lib/pipeline/record-run.ts (recordPipelineRun)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { recordPipelineRun } from '@/lib/pipeline/record-run';
import { PipelineErrorClassSchema } from '@/lib/pipeline/error-classes';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 10;

/**
 * Per-stage row-count vocabulary — the six canonical cocoindex pipeline
 * stages per `docs/plans/phase-0-investigation/architecture/02-data-flow.md`
 * §3.1. Every stage MUST be present in the payload (even when 0) so the
 * `pipeline_runs.result.stage_counts` shape is consistent across all runs;
 * partial payloads would break Inv-17's per-stage observability contract.
 */
const StageCountsSchema = z.object({
  source_walk: z.number().int().nonnegative(),
  binary_conversion: z.number().int().nonnegative(),
  llm_extraction: z.number().int().nonnegative(),
  embedding: z.number().int().nonnegative(),
  entity_resolution: z.number().int().nonnegative(),
  postgres_upsert: z.number().int().nonnegative(),
});

/**
 * Pipeline-run status vocabulary — extends `PipelineRunStatus` from
 * `recordPipelineRun()` with `in_progress` so the cocoindex sidecar can
 * emit a flow-start row (Inv-16: one `pipeline_runs` row per invocation,
 * which includes the start row not just the end row).
 *
 * `recordPipelineRun()`'s native type accepts only the three terminal
 * statuses; the route accepts `in_progress` AND forwards it. The helper's
 * `pipeline_runs.status` column is a free `text` column at the DB level
 * (see `supabase/types/database.types.ts:pipeline_runs.Row.status: string`)
 * so the wider vocabulary is safe to write; only `recordPipelineRun()`'s
 * Sentry-alerting switch is constrained to the three terminal statuses
 * (in_progress never triggers an alert — that's the desired behaviour for
 * flow-start emissions).
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
  /** Per-stage counters — all six stages required (see StageCountsSchema). */
  stageCounts: StageCountsSchema,
  /** Human-readable failure summary (optional; populated on terminal failure). */
  errorMessage: z.string().optional(),
  /**
   * 6-class stage-level error vocabulary from ID-28.13 (optional;
   * populated on terminal failure). Strict-validated via
   * `PipelineErrorClassSchema` so unknown classes from a sidecar that
   * drifts out of sync surface as HTTP 400 at the trust boundary rather
   * than silently landing in `pipeline_runs.result.error_class` and
   * breaking operator filter-by-cause queries.
   *
   * Source of truth: `lib/pipeline/error-classes.ts` —
   * PRODUCT.md Inv-25 verbatim. The pydantic-level sub-classes from
   * `_PYDANTIC_ERROR_TO_ERROR_CLASS` (extraction.py) live at a deeper
   * abstraction and MUST be wrapped by `extraction_validation_failed`
   * before crossing this boundary.
   */
  errorClass: PipelineErrorClassSchema.optional(),
  /** IMAGE_SHA from Cloud Build (28.6) — Inv-8 forensic correlation key. */
  extractorVersion: z.string().optional(),
  /**
   * Per-flow retry count from the cocoindex sidecar (ID-28.13 — Inv-23
   * transient-failure observability). The Python sidecar increments a
   * flow-scope counter on each transient-error retry (currently driven
   * by KH-authored retry wrappers — see flow.py `_FlowRetryCounter` for
   * the v1 substrate; cocoindex 1.0.3's native `ComponentStats.num_
   * reprocesses` surface is observable only from outside `app_main()`
   * and is therefore not the emission source today). Lands inside
   * `pipeline_runs.result.retry_count` so operator filter-by-retries
   * queries work uniformly with the rest of the result envelope.
   *
   * Optional for back-compat with pre-28.13 sidecar emissions; when
   * present, must be a nonneg integer (negative or float would indicate
   * a sidecar bug and is rejected at the boundary so the corrupt value
   * does not silently land).
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

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    logger.warn(
      { issues: parsed.error.issues },
      'pipeline-runs/record: payload validation failed',
    );
    return NextResponse.json(
      {
        error: 'invalid_payload',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
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

  // Compose the `result` JSON column so per-stage observability (Inv-17),
  // version forensics (Inv-8), the 6-class error vocabulary (28.13), and
  // the Inv-23 retry-count rollup all land in one structured envelope. The
  // `pipeline_runs.result` column is `Json | null` per
  // supabase/types/database.types.ts — any JSON shape is accepted at the DB
  // level; the shape contract is policed by the integration tests in 28.14
  // (stage-topology.integration.test.ts etc.).
  //
  // `retry_count` uses an explicit `!== undefined` check rather than the
  // truthy-coercion pattern used for extractorVersion / errorClass because
  // 0 is a meaningful value (the no-retry happy path) and must land
  // verbatim — operator dashboards relying on
  // `result.retry_count IS NOT NULL` to count emitted-with-retry-info runs
  // depend on this distinction.
  const result: Record<string, unknown> = {
    stage_counts: stageCounts,
  };
  if (extractorVersion) result.extractor_version = extractorVersion;
  if (errorClass) result.error_class = errorClass;
  if (retryCount !== undefined) result.retry_count = retryCount;

  try {
    const supabase = createServiceClient();
    // `recordPipelineRun()` accepts only the three terminal statuses in its
    // type definition (`PipelineRunStatus`) — its Sentry-alerting branch
    // gates on those. For `in_progress` flow-start emissions we cast to the
    // wider DB-level vocabulary; the helper writes the literal value into
    // `pipeline_runs.status` (free `text` column) and the `if (status === 'completed') return`
    // early-return path means no spurious Sentry alert fires for in_progress.
    await recordPipelineRun({
      supabase,
      pipelineName,
      status: status as 'completed' | 'completed_with_errors' | 'failed',
      itemsProcessed,
      itemsCreated,
      opId,
      errorMessage: errorMessage ?? null,
      result: result as Json,
    });
  } catch (err) {
    // recordPipelineRun is "never throws" by contract — this catch is a
    // belt-and-braces guard so the Python sidecar always gets a clean HTTP
    // response, even if the helper's contract is ever violated.
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
