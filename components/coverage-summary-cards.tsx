'use client';

import { useMemo } from 'react';
import { BarChart3, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageSummaryRow {
  domain_name: string;
  domain_colour: string | null;
  total_items: number;
  fresh_pct: number;
  gap_count: number;
  expired_count: number;
}

interface CoverageSummaryCardsProps {
  summary: CoverageSummaryRow[];
}

// ---------------------------------------------------------------------------
// Single stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  colourClass,
  suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  colourClass: string;
  suffix?: string;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-center gap-3">
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            colourClass,
          )}
        >
          <Icon className="size-5 text-primary-foreground" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {value}
            {suffix && (
              <span className="ml-0.5 text-base font-medium text-muted-foreground">
                {suffix}
              </span>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary Cards
// ---------------------------------------------------------------------------

export function CoverageSummaryCards({ summary }: CoverageSummaryCardsProps) {
  const stats = useMemo(() => {
    const totalItems = summary.reduce((sum, d) => sum + d.total_items, 0);

    // Weighted average fresh percentage
    const weightedFreshPct =
      totalItems > 0
        ? summary.reduce((sum, d) => sum + d.fresh_pct * d.total_items, 0) /
          totalItems
        : 0;

    const totalGaps = summary.reduce((sum, d) => sum + d.gap_count, 0);
    const totalExpired = summary.reduce((sum, d) => sum + d.expired_count, 0);

    return { totalItems, weightedFreshPct, totalGaps, totalExpired };
  }, [summary]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={BarChart3}
        label="Total Items"
        value={stats.totalItems.toLocaleString('en-GB')}
        colourClass="bg-primary"
      />
      <StatCard
        icon={CheckCircle}
        label="Fresh"
        value={Math.round(stats.weightedFreshPct)}
        suffix="%"
        colourClass="bg-freshness-fresh"
      />
      <StatCard
        icon={AlertTriangle}
        label="Content Gaps"
        value={stats.totalGaps}
        colourClass="bg-freshness-aging"
      />
      <StatCard
        icon={XCircle}
        label="Expired Items"
        value={stats.totalExpired}
        colourClass="bg-freshness-expired"
      />
    </div>
  );
}
