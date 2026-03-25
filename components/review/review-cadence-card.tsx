'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReviewCadenceResponse } from '@/app/api/review/cadence/route';

interface ReviewCadenceCardProps {
  className?: string;
}

/**
 * Review cadence dashboard card — shows aggregate review health metrics,
 * domain breakdown, and overdue items.
 */
export function ReviewCadenceCard({ className }: ReviewCadenceCardProps) {
  const [data, setData] = useState<ReviewCadenceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverdue, setShowOverdue] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchCadence() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch('/api/review/cadence');
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load review cadence');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchCadence();
    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return (
      <Card className={cn('', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="size-4" aria-hidden="true" />
            Review Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div role="status" aria-label="Loading review health" className="space-y-3">
            <div className="h-4 w-48 animate-pulse rounded bg-accent" />
            <div className="h-4 w-32 animate-pulse rounded bg-accent" />
            <div className="h-4 w-40 animate-pulse rounded bg-accent" />
            <span className="sr-only">Loading review health data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn('', className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="size-4" aria-hidden="true" />
            Review Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { summary, overdue_items, by_domain } = data;
  const domainEntries = Object.entries(by_domain).sort(
    ([, a], [, b]) => b.overdue - a.overdue || b.total - a.total,
  );

  const overduePercentage = summary.total_items > 0
    ? Math.round((summary.overdue / summary.total_items) * 100)
    : 0;

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4" aria-hidden="true" />
          Review Health
          {summary.overdue > 0 && (
            <Badge
              variant="outline"
              className="ml-1 border-bid-overdue-border bg-bid-overdue-bg text-bid-overdue text-[10px]"
            >
              {summary.overdue} overdue
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-3" role="list" aria-label="Review health metrics">
          <MetricCell
            label="Never reviewed"
            value={summary.never_reviewed}
            total={summary.total_items}
            highlight={summary.never_reviewed > 0 ? 'warning' : 'default'}
          />
          <MetricCell
            label="Avg. days since review"
            value={summary.average_days_since_review}
            suffix="days"
            highlight={summary.average_days_since_review > 90 ? 'warning' : 'default'}
          />
          <MetricCell
            label="Overdue"
            value={summary.overdue}
            total={summary.total_items}
            highlight={summary.overdue > 0 ? 'danger' : 'default'}
          />
        </div>

        {/* Review recency breakdown */}
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">Review recency</h4>
          <div className="flex gap-2 text-xs">
            <span className="rounded-md bg-muted px-2 py-1">
              Last 7d: <strong>{summary.reviewed_last_7_days}</strong>
            </span>
            <span className="rounded-md bg-muted px-2 py-1">
              Last 30d: <strong>{summary.reviewed_last_30_days}</strong>
            </span>
            <span className="rounded-md bg-muted px-2 py-1">
              Last 90d: <strong>{summary.reviewed_last_90_days}</strong>
            </span>
          </div>
        </div>

        {/* Domain breakdown table */}
        {domainEntries.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">By domain</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" role="table" aria-label="Review cadence by domain">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-1.5 pr-3 font-medium">Domain</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Total</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Unreviewed</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Avg. days</th>
                    <th className="pb-1.5 text-right font-medium">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {domainEntries.map(([domain, stats]) => (
                    <tr key={domain} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{domain}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{stats.total}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <span className={stats.never_reviewed > 0 ? 'text-freshness-stale' : ''}>
                          {stats.never_reviewed}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {stats.average_days > 0 ? stats.average_days : '\u2014'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        <span className={stats.overdue > 0 ? 'font-semibold text-bid-overdue' : ''}>
                          {stats.overdue}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Overdue items (collapsible) */}
        {overdue_items.length > 0 && (
          <div className="space-y-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowOverdue(!showOverdue)}
              className="h-auto gap-1 px-0 py-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={showOverdue}
              aria-controls="overdue-items-list"
            >
              {showOverdue ? (
                <ChevronUp className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              )}
              {overdue_items.length} overdue {overdue_items.length === 1 ? 'item' : 'items'}
              {overduePercentage > 0 && (
                <span className="ml-1 text-bid-overdue">({overduePercentage}%)</span>
              )}
            </Button>

            {showOverdue && (
              <ul
                id="overdue-items-list"
                className="max-h-48 space-y-1 overflow-y-auto"
                role="list"
                aria-label="Overdue review items"
              >
                {overdue_items.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
                    <AlertTriangle
                      className="size-3 shrink-0 text-bid-overdue"
                      aria-hidden="true"
                    />
                    <Link
                      href={`/content/${item.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {item.title}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">
                      {item.days_since_review === -1 ? (
                        <span className="text-freshness-stale">Never reviewed</span>
                      ) : (
                        <span className="text-bid-overdue">{item.days_since_review}d ago</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Internal metric cell
// ---------------------------------------------------------------------------

interface MetricCellProps {
  label: string;
  value: number;
  total?: number;
  suffix?: string;
  highlight?: 'default' | 'warning' | 'danger';
}

function MetricCell({ label, value, total, suffix, highlight = 'default' }: MetricCellProps) {
  const valueClasses = cn(
    'text-lg font-semibold tabular-nums',
    highlight === 'warning' && 'text-freshness-stale',
    highlight === 'danger' && 'text-bid-overdue',
  );

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2" role="listitem">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={valueClasses}>
        {value.toLocaleString('en-GB')}
        {total != null && (
          <span className="text-xs font-normal text-muted-foreground">
            /{total.toLocaleString('en-GB')}
          </span>
        )}
        {suffix && (
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}
