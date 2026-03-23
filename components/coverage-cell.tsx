'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageCellData {
  domain_name: string;
  subtopic_name: string;
  item_count: number;
  fresh_count: number;
  aging_count: number;
  stale_count: number;
  expired_count: number;
}

interface CoverageCellProps {
  data: CoverageCellData;
  formatSubtopic: (subtopic: string) => string;
}

// ---------------------------------------------------------------------------
// Freshness indicator dot + label (WCAG: colour + text + icon)
// ---------------------------------------------------------------------------

function FreshnessIndicator({
  label,
  count,
  colourClass,
}: {
  label: string;
  count: number;
  colourClass: string;
}) {
  if (count === 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span
        className={cn('inline-block size-2.5 shrink-0 rounded-full', colourClass)}
        aria-hidden="true"
      />
      <span>
        {count} {label}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Coverage Cell
// ---------------------------------------------------------------------------

export function CoverageCell({ data, formatSubtopic }: CoverageCellProps) {
  const searchParams = new URLSearchParams({
    domain: data.domain_name,
    subtopic: data.subtopic_name,
    include_qa: 'true',
  });

  const staleItemCount = data.stale_count + data.expired_count;
  const reviewStaleParams = new URLSearchParams({
    domain: data.domain_name,
    status: 'all',
  });
  const reviewStaleHref = `/review?${reviewStaleParams.toString()}`;

  return (
    <div
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-card p-3',
        'transition-colors hover:border-primary/40 hover:bg-accent/50',
      )}
    >
      <Link
        href={`/browse?${searchParams.toString()}`}
        className={cn(
          'flex flex-col gap-2',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm',
        )}
      >
        {/* Subtopic name */}
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
          {formatSubtopic(data.subtopic_name)}
        </span>

        {/* Item count */}
        <span className="text-2xl font-bold tabular-nums text-foreground">
          {data.item_count}
        </span>

        {/* Freshness breakdown */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <FreshnessIndicator
            label="Fresh"
            count={data.fresh_count}
            colourClass="bg-freshness-fresh"
          />
          <FreshnessIndicator
            label="Aging"
            count={data.aging_count}
            colourClass="bg-freshness-aging"
          />
          <FreshnessIndicator
            label="Stale"
            count={data.stale_count}
            colourClass="bg-freshness-stale"
          />
          <FreshnessIndicator
            label="Expired"
            count={data.expired_count}
            colourClass="bg-freshness-expired"
          />
        </div>
      </Link>

      {/* Review stale items link — only when stale or expired items exist */}
      {staleItemCount > 0 && (
        <Link
          href={reviewStaleHref}
          className={cn(
            'mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground',
            'transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm',
          )}
          aria-label={`Review ${staleItemCount} stale ${staleItemCount === 1 ? 'item' : 'items'} in ${formatSubtopic(data.subtopic_name)}`}
        >
          Review stale {staleItemCount === 1 ? 'item' : 'items'}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
