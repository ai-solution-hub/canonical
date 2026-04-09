'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MetricsPanel } from '@/components/intelligence/metrics-panel';
import { FilterRatioChart } from '@/components/intelligence/filter-ratio-chart';
import { PromptPerformanceTable } from '@/components/intelligence/prompt-performance-table';
import { useIntelligenceMetrics } from '@/hooks/intelligence/use-intelligence-metrics';
import { useMetricsTrend } from '@/hooks/intelligence/use-metrics-trend';
import { usePromptPerformance } from '@/hooks/intelligence/use-prompt-performance';

type Period = '30d' | '90d' | '180d';
type Granularity = 'daily' | 'weekly';

const PERIODS: { value: Period; label: string }[] = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 180 days' },
];

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

interface MetricsDashboardProps {
  workspaceId: string;
}

export function MetricsDashboard({ workspaceId }: MetricsDashboardProps) {
  const [period, setPeriod] = useState<Period>('90d');
  const [granularity, setGranularity] = useState<Granularity>('daily');

  const metricsQuery = useIntelligenceMetrics(workspaceId, period);
  const trendQuery = useMetricsTrend(workspaceId, granularity, period);
  const promptQuery = usePromptPerformance(workspaceId);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Workspace metrics
        </h2>
        <div className="flex gap-2">
          {/* Period selector */}
          <div className="flex gap-1">
            {PERIODS.map(({ value, label }) => (
              <Button
                key={value}
                variant={period === value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setPeriod(value)}
                className="h-7 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>

          {/* Granularity toggle */}
          <div className="flex gap-1 border-l pl-2">
            {GRANULARITIES.map(({ value, label }) => (
              <Button
                key={value}
                variant={granularity === value ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setGranularity(value)}
                className="h-7 text-xs"
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      {metricsQuery.data && <MetricsPanel metrics={metricsQuery.data} />}
      {metricsQuery.isLoading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border bg-muted"
            />
          ))}
        </div>
      )}
      {metricsQuery.isError && !metricsQuery.isLoading && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          Metrics are temporarily unavailable. Please refresh to try again.
        </div>
      )}

      {/* Filter ratio trend chart */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Relevant articles per week
        </h3>
        {trendQuery.isLoading ? (
          <div className="h-[200px] animate-pulse rounded-lg border bg-muted" />
        ) : (
          <FilterRatioChart
            data={trendQuery.data ?? []}
            granularity={granularity}
          />
        )}
      </div>

      {/* Prompt performance table */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Filter rule history
        </h3>
        {promptQuery.isLoading ? (
          <div className="h-32 animate-pulse rounded-lg border bg-muted" />
        ) : (
          <PromptPerformanceTable data={promptQuery.data ?? []} />
        )}
      </div>
    </div>
  );
}
