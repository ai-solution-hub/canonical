'use client';

import { AlertTriangle, Grid3x3, FileText, BookOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { UnifiedGapSummary } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Single stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  colourClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  colourClass: string;
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
            {value.toLocaleString('en-GB')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

interface PriorityGapsSummaryProps {
  summary: UnifiedGapSummary;
}

export function PriorityGapsSummary({ summary }: PriorityGapsSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={AlertTriangle}
        label="Total gaps"
        value={summary.total_gaps}
        colourClass="bg-destructive"
      />
      <StatCard
        icon={Grid3x3}
        label="Taxonomy gaps"
        value={summary.taxonomy_gaps}
        colourClass="bg-primary"
      />
      <StatCard
        icon={FileText}
        label="Template gaps"
        value={summary.template_gaps}
        colourClass="bg-accent"
      />
      <StatCard
        icon={BookOpen}
        label="Guide gaps"
        value={summary.guide_gaps}
        colourClass="bg-muted-foreground"
      />
    </div>
  );
}
