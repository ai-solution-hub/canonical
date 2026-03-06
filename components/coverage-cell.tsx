'use client';

import Link from 'next/link';
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
        className={cn('inline-block size-2 shrink-0 rounded-full', colourClass)}
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
  });

  return (
    <Link
      href={`/browse?${searchParams.toString()}`}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border border-border bg-card p-3',
        'transition-colors hover:border-primary/40 hover:bg-accent/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
          colourClass="bg-emerald-500"
        />
        <FreshnessIndicator
          label="Aging"
          count={data.aging_count}
          colourClass="bg-amber-500"
        />
        <FreshnessIndicator
          label="Stale"
          count={data.stale_count}
          colourClass="bg-orange-500"
        />
        <FreshnessIndicator
          label="Expired"
          count={data.expired_count}
          colourClass="bg-red-500"
        />
      </div>
    </Link>
  );
}
