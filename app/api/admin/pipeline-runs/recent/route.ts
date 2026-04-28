/**
 * GET /api/admin/pipeline-runs/recent
 *
 * Returns the last 24h of `pipeline_runs` rows, grouped by pipeline_name,
 * with counts and last-run metadata. Feeds the S152B WP4 admin dashboard
 * tile (`components/intelligence/pipeline-runs-panel.tsx`) that gives
 * Liam a single place to see "is my background automation healthy?".
 *
 * Admin-only. This is the "glance" side of the monitoring story —
 * `recordPipelineRun` (lib/pipeline/record-run.ts) fires Sentry alerts
 * for actionable single failures, this endpoint powers the passive
 * dashboard for "is everything green right now?".
 *
 * Closes Liam's Q-10 decision and roadmap §1.7.
 */

import { NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { sb } from '@/lib/supabase/safe';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 15;

/**
 * Group key: the `pipeline_name` from `pipeline_runs` rows, e.g.
 * `content_gaps`, `freshness_transitions`, `quality_score`.
 */
export interface PipelineRunSummary {
  pipelineName: string;
  runCount: number;
  failureCount: number;
  completedWithErrorsCount: number;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
}

export interface PipelineRunsRecentResponse {
  windowHours: number;
  generatedAt: string;
  summaries: PipelineRunSummary[];
  totalRuns: number;
  totalFailures: number;
  hasAnyFailures: boolean;
}

export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const windowHours = 24;
    const since = new Date(
      Date.now() - windowHours * 60 * 60 * 1000,
    ).toISOString();

    const rows = await sb(
      supabase
        .from('pipeline_runs')
        .select(
          'pipeline_name, status, started_at, completed_at, error_message',
        )
        .gte('started_at', since)
        .order('started_at', { ascending: false }),
      'admin.pipeline_runs.recent',
    );

    // Group by pipeline_name for the dashboard summary.
    const byPipeline = new Map<string, PipelineRunSummary>();
    for (const row of rows) {
      const existing = byPipeline.get(row.pipeline_name);
      const runTimestamp = row.completed_at ?? row.started_at;
      const isFailure = row.status === 'failed';
      const isDegraded = row.status === 'completed_with_errors';

      if (!existing) {
        byPipeline.set(row.pipeline_name, {
          pipelineName: row.pipeline_name,
          runCount: 1,
          failureCount: isFailure ? 1 : 0,
          completedWithErrorsCount: isDegraded ? 1 : 0,
          lastRunAt: runTimestamp,
          lastRunStatus: row.status,
          lastFailureAt: isFailure ? runTimestamp : null,
          lastFailureMessage: isFailure ? (row.error_message ?? null) : null,
        });
        continue;
      }

      existing.runCount += 1;
      if (isFailure) {
        existing.failureCount += 1;
        // Rows are ordered started_at DESC, so the first failure we
        // encounter for a given pipeline is the most recent one.
        if (!existing.lastFailureAt) {
          existing.lastFailureAt = runTimestamp;
          existing.lastFailureMessage = row.error_message ?? null;
        }
      }
      if (isDegraded) {
        existing.completedWithErrorsCount += 1;
      }
    }

    const summaries = Array.from(byPipeline.values()).sort((a, b) =>
      a.pipelineName.localeCompare(b.pipelineName),
    );

    const totalRuns = rows.length;
    const totalFailures = summaries.reduce((acc, s) => acc + s.failureCount, 0);

    const body: PipelineRunsRecentResponse = {
      windowHours,
      generatedAt: new Date().toISOString(),
      summaries,
      totalRuns,
      totalFailures,
      hasAnyFailures: totalFailures > 0,
    };

    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(err, 'Failed to load recent pipeline runs'),
      },
      { status: 500 },
    );
  }
}
