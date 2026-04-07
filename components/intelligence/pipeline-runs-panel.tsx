'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type { PipelineRunsRecentResponse } from '@/app/api/admin/pipeline-runs/recent/route';

/**
 * Admin dashboard tile showing the last 24h of background cron health.
 *
 * S152B WP4: closes Liam's Q-10 decision and roadmap §1.7. Paired with
 * Sentry alerting (fired by `lib/pipeline/record-run.ts` on every
 * non-`completed` run), this tile provides the passive "is everything
 * green right now?" glance. It's deliberately small — a single card
 * that shows per-pipeline last-run status with red indicators on any
 * failures — and is rendered admin-only via the calling dashboard.
 *
 * Data source: `GET /api/admin/pipeline-runs/recent` (admin-only).
 *
 * Usage:
 * ```tsx
 * {userRole === 'admin' ? <PipelineRunsPanel /> : null}
 * ```
 */
export function PipelineRunsPanel() {
  const query = useQuery({
    queryKey: queryKeys.admin.pipelineRunsRecent,
    queryFn: () =>
      fetchJson<PipelineRunsRecentResponse>(
        '/api/admin/pipeline-runs/recent',
      ),
    // Poll every 5 minutes — background cron runs are slow-moving
    // enough that a 5-minute refresh is plenty.
    refetchInterval: 5 * 60 * 1000,
    // Pre-launch Liam is the only user; window-focus refresh avoids
    // stale indicators when he switches tabs.
    refetchOnWindowFocus: true,
  });

  if (query.isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Pipeline runs (last 24h)</h2>
        <div className="mt-3 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="rounded-lg border border-status-error/30 bg-status-error/5 p-4">
        <h2 className="text-sm font-semibold text-status-error">
          Pipeline runs (last 24h)
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Failed to load recent pipeline runs. Check the browser console
          for details.
        </p>
      </section>
    );
  }

  const data = query.data;
  if (!data) return null;

  const bannerTone = data.hasAnyFailures
    ? 'border-status-error/30 bg-status-error/5'
    : 'border-border bg-card';
  const headerIcon = data.hasAnyFailures ? (
    <AlertTriangle
      className="size-4 text-status-error"
      aria-hidden="true"
    />
  ) : (
    <CheckCircle2
      className="size-4 text-status-success"
      aria-hidden="true"
    />
  );

  return (
    <section className={cn('rounded-lg border p-4', bannerTone)}>
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {headerIcon}
          Pipeline runs (last 24h)
        </h2>
        <Badge variant="outline" className="text-xs tabular-nums">
          {data.totalRuns} run{data.totalRuns === 1 ? '' : 's'}
          {data.totalFailures > 0 ? ` · ${data.totalFailures} failed` : ''}
        </Badge>
      </header>

      {data.summaries.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          No pipeline runs recorded in the last 24 hours. If any cron job
          is scheduled to run within that window (content gaps, freshness
          transitions, quality score, coverage alerts, classification
          quality, intelligence poll), it may have silently failed to
          trigger — investigate via the Vercel cron dashboard.
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-xs">
          {data.summaries.map((summary) => {
            const hasFailures = summary.failureCount > 0;
            const hasDegraded = summary.completedWithErrorsCount > 0;
            return (
              <li
                key={summary.pipelineName}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5',
                  hasFailures
                    ? 'border-status-error/30 bg-status-error/5'
                    : hasDegraded
                      ? 'border-status-warning/30 bg-status-warning/5'
                      : 'border-border/60 bg-muted/20',
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {hasFailures ? (
                    <XCircle
                      className="size-3.5 shrink-0 text-status-error"
                      aria-hidden="true"
                    />
                  ) : hasDegraded ? (
                    <AlertTriangle
                      className="size-3.5 shrink-0 text-status-warning"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2
                      className="size-3.5 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate font-medium">
                    {summary.pipelineName}
                  </span>
                  {hasFailures && summary.lastFailureMessage ? (
                    <span className="truncate text-muted-foreground">
                      — {summary.lastFailureMessage}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className="tabular-nums">
                    {summary.runCount}×
                    {hasFailures ? ` (${summary.failureCount} failed)` : ''}
                  </span>
                  {summary.lastRunAt ? (
                    <span
                      className="flex items-center gap-1"
                      title={summary.lastRunAt}
                    >
                      <Clock className="size-3" aria-hidden="true" />
                      {formatRelative(summary.lastRunAt)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
