/**
 * GET /api/admin/provenance/pipeline-runs
 *
 * Admin-only endpoint returning pipeline_runs with keyset pagination
 * and a server-side rollup grouped by pipeline_name.
 *
 * Query params (see AdminProvenancePipelineRunsParamsSchema):
 *   range       — '1h' | '24h' | '7d' | '30d' (default '24h')
 *   kinds       — comma-separated pipeline names filter (optional)
 *   limit       — page size 1–200 (default 50)
 *   cursor_started_at + cursor_id — keyset pagination cursor
 *
 * Returns a warningsEnvelope with:
 *   rows        — pipeline_runs page
 *   rollup      — per-pipeline summary
 *   hasMore     — whether more rows exist
 *   nextCursor  — { started_at, id } for next page, or null
 *   window      — { range, since }
 */

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { isOk, tryQuery } from '@/lib/supabase/safe';
import {
  createWarningsCollector,
  warningsEnvelope,
} from '@/lib/supabase/warnings';
import { parseSearchParams } from '@/lib/validation';
import { AdminProvenancePipelineRunsParamsSchema } from '@/lib/validation/schemas';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 15;

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

const RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function rangeToIso(range: string): string {
  const ms = RANGE_MS[range] ?? RANGE_MS['24h'];
  return new Date(Date.now() - ms).toISOString();
}

/** Safety cap: max rows scanned for the rollup query. */
const ROLLUP_SCAN_LIMIT = 20_000;

/** Columns selected for the paginated list. */
const LIST_COLUMNS =
  'id, pipeline_name, status, started_at, completed_at, items_processed, error_message, source_filename, workspace_id, created_by, result, progress, items_created, cost';

export interface PipelineRollupEntry {
  pipelineName: string;
  runs: number;
  completed: number;
  failed: number;
  running: number;
  completedWithErrors: number;
  successPct: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  lastRunAt: string | null;
}

// ──────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────

// TODO(OPS-T1): author ResponseSchema
export const GET = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Parse + validate query params
    const parsed = parseSearchParams(
      AdminProvenancePipelineRunsParamsSchema,
      request.nextUrl.searchParams,
    );
    if (!parsed.success) return parsed.response;
    const { range, kinds, limit, cursor_started_at, cursor_id } = parsed.data;

    const since = rangeToIso(range);
    const warnings = createWarningsCollector();

    // ── List query (keyset pagination) ────────────────────────────
    let listQuery = supabase
      .from('pipeline_runs')
      .select(LIST_COLUMNS)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1); // fetch one extra to detect hasMore

    if (kinds && kinds.length > 0) {
      listQuery = listQuery.in('pipeline_name', kinds);
    }

    // Keyset cursor: rows strictly before the cursor position
    if (cursor_started_at && cursor_id) {
      listQuery = listQuery.or(
        `started_at.lt.${cursor_started_at},and(started_at.eq.${cursor_started_at},id.lt.${cursor_id})`,
      );
    }

    const listResult = await tryQuery(
      listQuery,
      'provenance.pipelineRuns.list',
    );

    let rows: typeof listResult extends { ok: true; data: infer D }
      ? D
      : never[] = [];
    let hasMore = false;
    let nextCursor: { started_at: string; id: string } | null = null;

    if (isOk(listResult)) {
      const allRows = listResult.data as Array<Record<string, unknown>>;
      if (allRows.length > limit) {
        hasMore = true;
        allRows.pop(); // remove the extra sentinel row
      }
      rows = allRows as typeof rows;
      if (hasMore && allRows.length > 0) {
        const last = allRows[allRows.length - 1];
        nextCursor = {
          started_at: last.started_at as string,
          id: last.id as string,
        };
      }
    } else {
      warnings.add('Pipeline runs list could not be loaded');
    }

    // ── Rollup query (same window, no pagination, capped) ────────
    let rollupQuery = supabase
      .from('pipeline_runs')
      .select('pipeline_name, status, started_at, completed_at')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(ROLLUP_SCAN_LIMIT);

    if (kinds && kinds.length > 0) {
      rollupQuery = rollupQuery.in('pipeline_name', kinds);
    }

    const rollupResult = await tryQuery(
      rollupQuery,
      'provenance.pipelineRuns.rollup',
    );

    let rollup: PipelineRollupEntry[] = [];

    if (isOk(rollupResult)) {
      const rollupRows = rollupResult.data as Array<{
        pipeline_name: string;
        status: string;
        started_at: string;
        completed_at: string | null;
      }>;

      if (rollupRows.length >= ROLLUP_SCAN_LIMIT) {
        warnings.add(
          `Rollup truncated at ${ROLLUP_SCAN_LIMIT.toLocaleString()} rows — stats are approximate`,
        );
      }

      rollup = computeRollup(rollupRows);
    } else {
      warnings.add('Pipeline rollup could not be computed');
    }

    return warningsEnvelope(
      {
        rows,
        rollup,
        hasMore,
        nextCursor,
        window: { range, since },
      },
      warnings,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(err, 'Failed to load pipeline runs'),
      },
      { status: 500 },
    );
  }
});

// ──────────────────────────────────────────
// Rollup computation
// ──────────────────────────────────────────

function computeRollup(
  rows: Array<{
    pipeline_name: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  }>,
): PipelineRollupEntry[] {
  const buckets = new Map<
    string,
    {
      runs: number;
      completed: number;
      failed: number;
      running: number;
      completedWithErrors: number;
      durations: number[];
      lastRunAt: string | null;
    }
  >();

  for (const row of rows) {
    let bucket = buckets.get(row.pipeline_name);
    if (!bucket) {
      bucket = {
        runs: 0,
        completed: 0,
        failed: 0,
        running: 0,
        completedWithErrors: 0,
        durations: [],
        lastRunAt: null,
      };
      buckets.set(row.pipeline_name, bucket);
    }

    bucket.runs += 1;

    if (row.status === 'completed') bucket.completed += 1;
    else if (row.status === 'failed') bucket.failed += 1;
    else if (row.status === 'running') bucket.running += 1;
    else if (row.status === 'completed_with_errors')
      bucket.completedWithErrors += 1;

    // Duration: only for runs that have completed_at
    if (row.completed_at) {
      const durationMs =
        new Date(row.completed_at).getTime() -
        new Date(row.started_at).getTime();
      if (durationMs >= 0) {
        bucket.durations.push(durationMs);
      }
    }

    // Rows are ordered DESC, so first encounter is the latest
    if (!bucket.lastRunAt) {
      bucket.lastRunAt = row.started_at;
    }
  }

  const entries: PipelineRollupEntry[] = [];
  for (const [name, bucket] of buckets) {
    const finishedCount = bucket.completed + bucket.completedWithErrors;
    const denominator = finishedCount + bucket.failed;
    const successPct =
      denominator > 0
        ? Math.round((finishedCount / denominator) * 100 * 10) / 10
        : 0;

    entries.push({
      pipelineName: name,
      runs: bucket.runs,
      completed: bucket.completed,
      failed: bucket.failed,
      running: bucket.running,
      completedWithErrors: bucket.completedWithErrors,
      successPct,
      avgDurationMs: avgOrNull(bucket.durations),
      p95DurationMs: p95OrNull(bucket.durations),
      lastRunAt: bucket.lastRunAt,
    });
  }

  // Sort alphabetically by pipeline name
  entries.sort((a, b) => a.pipelineName.localeCompare(b.pipelineName));
  return entries;
}

function avgOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round(sum / values.length);
}

function p95OrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}
