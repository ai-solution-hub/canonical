'use client';

import dynamic from 'next/dynamic';
import { Layers, FileText, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DigestDomainSection } from '@/components/digest/digest-domain-section';
import { formatDate } from '@/lib/format';
import { digestTypeLabel } from '@/lib/digest/digest-helpers';
import { FreshnessBadge } from '@/components/shared/freshness-badge';
import type { Digest, DigestGovernanceSummary } from '@/types/digest';
import { cn } from '@/lib/utils';

const DigestExportMenu = dynamic(
  () =>
    import('@/components/digest/digest-export-menu').then(
      (mod) => mod.DigestExportMenu,
    ),
  { ssr: false },
);

interface DigestViewProps {
  digest: Digest;
  className?: string;
}

export function DigestView({ digest, className }: DigestViewProps) {
  return (
    <div className={cn('space-y-8', className)}>
      {/* Header */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-fluid-2xl font-bold tracking-tight">
            {digestTypeLabel(digest.digest_type)}
          </h1>
          <Badge variant="secondary" className="text-sm font-normal">
            {digest.item_count} {digest.item_count === 1 ? 'item' : 'items'}
          </Badge>
          <div className="ml-auto flex items-center gap-2" data-no-print>
            <DigestExportMenu digest={digest} />
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
              <DigestDomainSection key={ds.domain} domainSummary={ds} />
            ))}
          </div>
        </section>
      )}

      {/* Review activity this period (governance summary) */}
      {digest.governance_summary && (
        <GovernanceSection summary={digest.governance_summary} />
      )}

      {/* Theme clusters */}
      <section className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Cross-Domain Themes
          </h2>
        </div>
        {digest.theme_clusters.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {digest.theme_clusters.map((cluster) => (
              <div
                key={cluster.theme}
                className="rounded-lg border bg-muted/30 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {cluster.theme}
                  </h3>
                  <Badge variant="outline" className="shrink-0 text-[11px]">
                    {cluster.item_count}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {cluster.description}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No cross-domain themes identified for this period.
          </p>
        )}
      </section>
    </div>
  );
}

/** Format a number as a delta string, e.g. 12 → "+12", 0 → "0". */
function formatDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function GovernanceSection({ summary }: { summary: DigestGovernanceSummary }) {
  const { items_modified, items_verified, items_flagged, freshness_breakdown } =
    summary;

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
      {freshness_breakdown && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Freshness Breakdown
          </p>
          <div className="flex flex-wrap gap-4">
            {(['fresh', 'aging', 'stale', 'expired'] as const).map((state) => (
              <div key={state} className="flex items-center gap-1.5">
                <FreshnessBadge freshness={state} compact />
                <span className="text-sm font-medium text-foreground">
                  {freshness_breakdown[state]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
