'use client';

import dynamic from 'next/dynamic';
import { FileText, Shield, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChangeReportDomainSection } from '@/components/change-reports/change-report-domain-section';
import { formatDate } from '@/lib/format';
import { changeReportFrequencyLabel } from '@/lib/change-reports/change-reports-helpers';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import type { ChangeReport, ChangeReportGovernanceSummary } from '@/types/change-reports';
import { cn } from '@/lib/utils';

const ChangeReportExportMenu = dynamic(
  () =>
    import('@/components/change-reports/change-report-export-menu').then(
      (mod) => mod.ChangeReportExportMenu,
    ),
  { ssr: false },
);

interface ChangeReportViewProps {
  digest: ChangeReport;
  className?: string;
}

export function ChangeReportView({ digest, className }: ChangeReportViewProps) {
  return (
    <div className={cn('space-y-8', className)}>
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-fluid-2xl font-bold tracking-tight">
            {changeReportFrequencyLabel(digest.frequency)}
          </h1>
          <Badge variant="secondary" className="text-sm font-normal">
            {digest.item_count} {digest.item_count === 1 ? 'item' : 'items'}
          </Badge>
          <div className="ml-auto flex items-center gap-2" data-no-print>
            <ChangeReportExportMenu digest={digest} />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDate(digest.period_start)} &ndash;{' '}
          {formatDate(digest.period_end)}
        </p>
      </header>

      {/* Narrative summary */}
      {digest.narrative_summary && (
        <section className="rounded-xl border bg-card p-6">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Overview
            </h2>
          </div>
          <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90">
            {digest.narrative_summary.split('\n\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </section>
      )}

      {/* Domain sections */}
      {digest.domain_summaries.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            By Domain
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {digest.domain_summaries.map((ds) => (
              <ChangeReportDomainSection key={ds.domain} domainSummary={ds} />
            ))}
          </div>
        </section>
      )}

      {/* Review activity this period (governance summary — period-scoped deltas only) */}
      {digest.governance_summary && (
        <ReviewActivitySection summary={digest.governance_summary} />
      )}

      {/* Current KB health — freshness breakdown (OPS-19: extracted from
          the period card because this is a current-state snapshot, not a
          period delta) */}
      {digest.governance_summary?.freshness_breakdown && (
        <KBHealthSection
          freshnessBreakdown={digest.governance_summary.freshness_breakdown}
        />
      )}

    </div>
  );
}

/** Format a number as a delta string, e.g. 12 -> "+12", 0 -> "0". */
function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Review Activity This Period — period-scoped deltas only (modified /
 * verified / flagged counts). OPS-19: freshness breakdown extracted to
 * KBHealthSection below.
 */
function ReviewActivitySection({
  summary,
}: {
  summary: ChangeReportGovernanceSummary;
}) {
  const { items_modified, items_verified, items_flagged } = summary;

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Shield className="size-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Review Activity This Period
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-background p-4 text-center">
          <p className="text-2xl font-bold text-foreground">
            {formatDelta(items_modified)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Items modified</p>
        </div>
        <div className="rounded-lg border bg-background p-4 text-center">
          <p className="text-2xl font-bold text-quality-good">
            {formatDelta(items_verified)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Items verified</p>
        </div>
        <div className="rounded-lg border bg-background p-4 text-center">
          <p className="text-2xl font-bold text-status-warning">
            {formatDelta(items_flagged)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Items flagged</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Current KB Health — freshness breakdown snapshot.
 *
 * OPS-19: Extracted from the period-scoped GovernanceSection because the
 * freshness breakdown (fresh/aging/stale/expired counts) is a current-state
 * snapshot of the entire KB, not a period delta. Rendered as its own card
 * below the "Review Activity This Period" section.
 */
function KBHealthSection({
  freshnessBreakdown,
}: {
  freshnessBreakdown: ChangeReportGovernanceSummary['freshness_breakdown'];
}) {
  if (!freshnessBreakdown) return null;

  return (
    <section className="rounded-xl border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="size-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Current KB Health
        </h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Freshness breakdown across all knowledge base items (current state, not
        period-specific).
      </p>
      <div className="flex flex-wrap gap-4">
        {(['fresh', 'aging', 'stale', 'expired'] as const).map((state) => (
          <div key={state} className="flex items-center gap-1.5">
            <FreshnessBadge freshness={state} compact />
            <span className="text-sm font-medium text-foreground">
              {freshnessBreakdown[state]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
