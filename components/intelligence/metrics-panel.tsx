'use client';

import { Badge } from '@/components/ui/badge';
import {
  FileText,
  CheckCircle,
  Flag,
  AlertTriangle,
  Rss,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';
import type { MetricsSummary } from '@/hooks/intelligence/use-intelligence-metrics';

interface MetricsPanelProps {
  metrics: MetricsSummary;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date(Date.now());
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24)
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  const mounted = useHydrated();

  if (!mounted) return null;

  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Articles Ingested */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="size-3.5" aria-hidden="true" />
            Articles Ingested
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {metrics.total_articles}
          </p>
        </div>

        {/* Articles Passed */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle className="size-3.5" aria-hidden="true" />
            Articles Passed
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {metrics.passed_articles}
          </p>
          <p className="text-xs text-muted-foreground">
            {metrics.filter_ratio}% pass rate
          </p>
        </div>

        {/* Articles Flagged */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flag className="size-3.5" aria-hidden="true" />
            Articles Flagged
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {metrics.total_flags}
          </p>
          <div className="mt-0.5 flex gap-2 text-xs text-muted-foreground">
            <span>Wrongly kept: {metrics.false_positive_flags}</span>
            <span>Missed: {metrics.false_negative_flags}</span>
          </div>
        </div>

        {/* Unresolved Flags */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5" aria-hidden="true" />
            Unresolved Flags
          </div>
          <p
            className={cn(
              'mt-1 text-2xl font-bold',
              metrics.unresolved_flags > 0
                ? 'text-destructive'
                : 'text-foreground',
            )}
          >
            {metrics.unresolved_flags}
          </p>
        </div>
      </div>

      {/* Feed health indicators */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Rss className="size-3.5" aria-hidden="true" />
          <span>
            Active Sources:{' '}
            <span className="font-medium text-foreground">
              {metrics.active_sources}
            </span>
          </span>
          {metrics.active_sources > 0 && (
            <Badge
              variant="outline"
              className="h-4 border-status-success/30 bg-status-success/10 px-1 text-[10px] text-status-success"
            >
              OK
            </Badge>
          )}
        </div>

        {metrics.sources_with_errors > 0 && (
          <div className="flex items-center gap-1.5">
            <AlertTriangle
              className="size-3.5 text-warning"
              aria-hidden="true"
            />
            <span>
              Sources with Errors:{' '}
              <span className="font-medium text-warning">
                {metrics.sources_with_errors}
              </span>
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5" aria-hidden="true" />
          <span>
            Last Poll:{' '}
            <span className="font-medium text-foreground">
              {formatRelativeTime(metrics.last_poll_time)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
