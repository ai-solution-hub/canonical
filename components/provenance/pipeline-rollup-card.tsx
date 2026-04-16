'use client';

import { cn } from '@/lib/utils';
import type { PipelineRollupEntry } from '@/app/api/admin/provenance/pipeline-runs/route';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function statusColour(entry: PipelineRollupEntry): string {
  if (entry.failed > 0) return 'border-destructive/50 bg-destructive/5';
  if (entry.completedWithErrors > 0) return 'border-warning/50 bg-warning/5';
  if (entry.running > 0) return 'border-primary/50 bg-primary/5';
  return 'border-border bg-card';
}

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

export interface PipelineRollupCardProps {
  entry: PipelineRollupEntry;
}

export default function PipelineRollupCard({ entry }: PipelineRollupCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        statusColour(entry),
      )}
    >
      <h3 className="text-sm font-semibold text-foreground">
        {entry.pipelineName.replace(/_/g, ' ')}
      </h3>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <span className="text-muted-foreground">Runs</span>
          <p className="font-medium text-foreground">{entry.runs}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Success</span>
          <p className="font-medium text-foreground">{entry.successPct}%</p>
        </div>
        <div>
          <span className="text-muted-foreground">Failed</span>
          <p
            className={cn(
              'font-medium',
              entry.failed > 0 ? 'text-destructive' : 'text-foreground',
            )}
          >
            {entry.failed}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Running</span>
          <p
            className={cn(
              'font-medium',
              entry.running > 0 ? 'text-primary' : 'text-foreground',
            )}
          >
            {entry.running}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Avg duration</span>
          <p className="font-medium text-foreground">
            {formatDuration(entry.avgDurationMs)}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">P95 duration</span>
          <p className="font-medium text-foreground">
            {formatDuration(entry.p95DurationMs)}
          </p>
        </div>
      </div>

      {entry.lastRunAt && (
        <p className="mt-3 text-xs text-muted-foreground">
          Last run:{' '}
          {new Date(entry.lastRunAt).toLocaleString('en-GB', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </p>
      )}
    </div>
  );
}
