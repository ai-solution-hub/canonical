'use client';

import { useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { PipelineRunDetail } from './pipeline-failure-drawer';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '--';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

const STATUS_CLASSES: Record<string, string> = {
  failed: 'bg-destructive/10 text-destructive',
  completed_with_errors: 'bg-warning/10 text-warning',
  running: 'bg-primary/10 text-primary',
  completed: 'bg-accent text-accent-foreground',
};

const CLICKABLE_STATUSES = new Set(['failed', 'completed_with_errors']);

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

/** @public */
export interface PipelineRunsListProps {
  rows: PipelineRunDetail[];
  onSelectRun: (run: PipelineRunDetail) => void;
}

export default function PipelineRunsList({
  rows,
  onSelectRun,
}: PipelineRunsListProps) {
  const handleRowClick = useCallback(
    (run: PipelineRunDetail) => {
      if (CLICKABLE_STATUSES.has(run.status)) {
        onSelectRun(run);
      }
    },
    [onSelectRun],
  );

  const handleKeyDown = useCallback(
    (run: PipelineRunDetail, e: React.KeyboardEvent) => {
      if (
        CLICKABLE_STATUSES.has(run.status) &&
        (e.key === 'Enter' || e.key === ' ')
      ) {
        e.preventDefault();
        onSelectRun(run);
      }
    },
    [onSelectRun],
  );

  // Stable empty state reference
  const emptyRows = useMemo(() => rows.length === 0, [rows.length]);

  if (emptyRows) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-muted-foreground">No pipeline runs in this window</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Pipeline
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Status
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Started
            </th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Duration
            </th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">
              Items
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => {
            const isClickable = CLICKABLE_STATUSES.has(run.status);
            return (
              <tr
                key={run.id}
                onClick={() => handleRowClick(run)}
                onKeyDown={(e) => handleKeyDown(run, e)}
                tabIndex={isClickable ? 0 : undefined}
                role={isClickable ? 'button' : undefined}
                className={cn(
                  'border-b transition-colors',
                  isClickable
                    ? 'cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    : '',
                )}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {run.pipeline_name.replace(/_/g, ' ')}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      STATUS_CLASSES[run.status] ??
                        'bg-muted text-muted-foreground',
                    )}
                  >
                    {run.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatTime(run.started_at)}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {formatDuration(run.started_at, run.completed_at)}
                </td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {run.items_processed ?? '--'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
