'use client';

import { useMemo } from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import type { CoverageTargetRow } from '@/hooks/use-coverage-targets';
import type { CoverageSummaryRow } from '@/components/coverage/coverage-summary-cards';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageTargetProgressProps {
  targets: CoverageTargetRow[];
  coverageData: CoverageSummaryRow[];
}

interface MetricProgress {
  metric_name: string;
  label: string;
  current: number;
  target: number;
  percentage: number;
  onTrack: boolean;
  displayCurrent: string;
  displayTarget: string;
}

interface DomainTargetSummary {
  domain_name: string;
  metrics: MetricProgress[];
  allOnTrack: boolean;
}

// ---------------------------------------------------------------------------
// Metric label helpers
// ---------------------------------------------------------------------------

function getMetricLabel(metric: string): string {
  switch (metric) {
    case 'item_count':
      return 'Item count';
    case 'fresh_pct':
      return 'Freshness %';
    case 'max_expired':
      return 'Max expired';
    default:
      return metric;
  }
}

function formatMetricValue(metric: string, value: number): string {
  switch (metric) {
    case 'fresh_pct':
      return `${Math.round(value)}%`;
    default:
      return String(Math.round(value));
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CoverageTargetProgress({
  targets,
  coverageData,
}: CoverageTargetProgressProps) {
  const domainSummaries = useMemo(() => {
    // Build a lookup from domain_name to coverage data
    const coverageByDomain = new Map<string, CoverageSummaryRow>();
    for (const row of coverageData) {
      coverageByDomain.set(row.domain_name, row);
    }

    // Group targets by domain_name
    const targetsByDomain = new Map<string, CoverageTargetRow[]>();
    for (const t of targets) {
      if (!t.domain_name) continue;
      const existing = targetsByDomain.get(t.domain_name) ?? [];
      existing.push(t);
      targetsByDomain.set(t.domain_name, existing);
    }

    const summaries: DomainTargetSummary[] = [];

    for (const [domainName, domainTargets] of targetsByDomain.entries()) {
      const coverage = coverageByDomain.get(domainName);
      const metrics: MetricProgress[] = [];

      for (const target of domainTargets) {
        let current = 0;
        let onTrack = false;

        switch (target.metric_name) {
          case 'item_count':
            current = coverage?.total_items ?? 0;
            onTrack = current >= target.target_value;
            break;
          case 'fresh_pct':
            current = coverage?.fresh_pct ?? 0;
            onTrack = current >= target.target_value;
            break;
          case 'max_expired':
            current = coverage?.expired_count ?? 0;
            // For max_expired, lower is better — on track when current <= target
            onTrack = current <= target.target_value;
            break;
        }

        // Calculate percentage for progress bar
        let percentage: number;
        if (target.metric_name === 'max_expired') {
          // Inverse: 100% when current is 0, 0% when current is 2x target
          const maxDisplay = Math.max(target.target_value * 2, 1);
          percentage = Math.max(0, Math.min(100, ((maxDisplay - current) / maxDisplay) * 100));
        } else {
          percentage =
            target.target_value > 0
              ? Math.min(100, (current / target.target_value) * 100)
              : current > 0
                ? 100
                : 0;
        }

        metrics.push({
          metric_name: target.metric_name,
          label: getMetricLabel(target.metric_name),
          current,
          target: target.target_value,
          percentage,
          onTrack,
          displayCurrent: formatMetricValue(target.metric_name, current),
          displayTarget: formatMetricValue(target.metric_name, target.target_value),
        });
      }

      summaries.push({
        domain_name: domainName,
        metrics,
        allOnTrack: metrics.every((m) => m.onTrack),
      });
    }

    return summaries;
  }, [targets, coverageData]);

  if (domainSummaries.length === 0) return null;

  return (
    <section aria-label="Coverage targets progress" className="space-y-4">
      <h3 className="text-sm font-medium text-muted-foreground">
        Coverage Targets
      </h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {domainSummaries.map((domain) => (
          <div
            key={domain.domain_name}
            className="rounded-lg border border-border bg-card p-4 space-y-3"
          >
            {/* Domain header */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                {domain.domain_name}
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-medium',
                  domain.allOnTrack
                    ? 'text-freshness-fresh'
                    : 'text-freshness-expired',
                )}
              >
                {domain.allOnTrack ? (
                  <>
                    <CheckCircle className="size-3.5" aria-hidden="true" />
                    On track
                  </>
                ) : (
                  <>
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    Below target
                  </>
                )}
              </span>
            </div>

            {/* Metrics */}
            {domain.metrics.map((metric) => (
              <div key={metric.metric_name} className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{metric.label}</span>
                  <span>
                    {metric.displayCurrent} / {metric.displayTarget}
                    {metric.metric_name === 'max_expired' ? ' max' : ''}
                  </span>
                </div>
                <Progress
                  value={metric.percentage}
                  className={cn(
                    'h-2',
                    metric.onTrack
                      ? '[&>[data-slot=progress-indicator]]:bg-freshness-fresh'
                      : '[&>[data-slot=progress-indicator]]:bg-freshness-expired',
                  )}
                  aria-label={`${metric.label}: ${metric.displayCurrent} of ${metric.displayTarget}`}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
