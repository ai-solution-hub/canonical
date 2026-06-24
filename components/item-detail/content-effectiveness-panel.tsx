'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, Minus, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcurementCitation {
  workspace_id: string;
  workspace_name: string;
  buyer: string | null;
  outcome: 'won' | 'lost' | 'withdrawn' | null;
  cited_at: string;
}

interface EffectivenessData {
  content_item_id: string;
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  bids: ProcurementCitation[];
}

interface ContentEffectivenessPanelProps {
  contentItemId: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the Warm Meridian colour class for the given win rate (0-1 decimal) */
function getWinRateColourClass(winRate: number): string {
  const pct = winRate * 100;
  if (pct >= 70) return 'bg-freshness-fresh';
  if (pct >= 40) return 'bg-freshness-aging';
  return 'bg-freshness-stale';
}

/** Returns the text colour class for the given win rate */
function getWinRateTextClass(winRate: number): string {
  const pct = winRate * 100;
  if (pct >= 70) return 'text-freshness-fresh';
  if (pct >= 40) return 'text-freshness-aging';
  return 'text-freshness-stale';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OutcomeBadge({
  outcome,
}: {
  outcome: 'won' | 'lost' | 'withdrawn' | null;
}) {
  if (outcome === 'won') {
    return (
      <span
        className="inline-flex items-center gap-1 text-freshness-fresh"
        aria-label="Outcome: Won"
      >
        <Check className="size-3.5" aria-hidden="true" />
        <span className="text-xs font-medium">Won</span>
      </span>
    );
  }

  if (outcome === 'lost') {
    return (
      <span
        className="inline-flex items-center gap-1 text-freshness-stale"
        aria-label="Outcome: Lost"
      >
        <X className="size-3.5" aria-hidden="true" />
        <span className="text-xs font-medium">Lost</span>
      </span>
    );
  }

  if (outcome === 'withdrawn') {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        aria-label="Outcome: Withdrawn"
      >
        <Minus className="size-3.5" aria-hidden="true" />
        <span className="text-xs font-medium">Withdrawn</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      aria-label="Outcome: Pending"
    >
      <Minus className="size-3.5" aria-hidden="true" />
      <span className="text-xs font-medium">Pending</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * Content effectiveness panel — displays win-rate feedback loop data
 * for a single content item. Shows citation count, win rate, and bid history.
 *
 * Three states:
 * 1. Zero citations: empty state explaining the feature
 * 2. Citations but no decided outcomes: "Awaiting outcomes" state
 * 3. Decided outcomes: full metrics with win rate bar and bid history
 */
export function ContentEffectivenessPanel({
  contentItemId,
  className = '',
}: ContentEffectivenessPanelProps) {
  const [data, setData] = useState<EffectivenessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchEffectiveness() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/items/${contentItemId}/effectiveness`,
        );

        if (!response.ok) {
          throw new Error('Failed to load effectiveness data');
        }

        const result: EffectivenessData = await response.json();
        if (!cancelled) {
          setData(result);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load effectiveness data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchEffectiveness();

    return () => {
      cancelled = true;
    };
  }, [contentItemId]);

  // --- Loading state ---
  if (loading) {
    return (
      <section
        className={`rounded-lg border bg-card p-4 ${className}`}
        aria-label="Content effectiveness"
        aria-busy="true"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Content Effectiveness
        </h2>
        <div className="flex gap-6">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="mt-4 h-2 w-full" />
      </section>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <section
        className={`rounded-lg border bg-card p-4 ${className}`}
        aria-label="Content effectiveness"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Content Effectiveness
        </h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    );
  }

  // --- Empty state (no citations) ---
  if (!data || data.total_citations === 0) {
    return (
      <section
        className={`rounded-lg border bg-card p-4 ${className}`}
        aria-label="Content effectiveness"
      >
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Content Effectiveness
        </h2>
        <p className="text-sm text-muted-foreground">
          This content has not yet been cited in any bid responses. Win rate
          data will appear here once this content is used in bids.
        </p>
      </section>
    );
  }

  // Determine if we have decided outcomes
  const hasDecidedOutcomes = data.winning_citations + data.losing_citations > 0;
  const winRatePct = Math.round(data.win_rate * 100);
  const distinctProcurements = data.bids.length;

  // Determine visible bids
  const MAX_VISIBLE = 5;
  const visibleProcurements = showAll
    ? data.bids
    : data.bids.slice(0, MAX_VISIBLE);
  const hasMore = data.bids.length > MAX_VISIBLE;

  return (
    <section
      className={`rounded-lg border bg-card p-4 ${className}`}
      aria-label="Content effectiveness"
    >
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Content Effectiveness
      </h2>

      {/* Metrics row */}
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {data.total_citations}
          </p>
          <p className="text-xs text-muted-foreground">citations</p>
        </div>
        <div>
          <p
            className={`text-sm font-semibold ${
              hasDecidedOutcomes
                ? getWinRateTextClass(data.win_rate)
                : 'text-muted-foreground'
            }`}
          >
            {hasDecidedOutcomes ? `${winRatePct}%` : '---'}
          </p>
          <p className="text-xs text-muted-foreground">
            {hasDecidedOutcomes ? 'win rate' : 'awaiting outcomes'}
          </p>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {distinctProcurements}
          </p>
          <p className="text-xs text-muted-foreground">bids used in</p>
        </div>
      </div>

      {/* Win rate bar — only shown when decided outcomes exist */}
      {hasDecidedOutcomes && (
        <div className="mt-4">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuenow={winRatePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Win rate"
          >
            <div
              className={`h-full rounded-full transition-all ${getWinRateColourClass(data.win_rate)}`}
              style={{ width: `${winRatePct}%` }}
            />
          </div>
        </div>
      )}

      {/* Procurement history list */}
      {data.bids.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Procurement History
          </h3>
          <ul className="divide-y divide-border" role="list">
            {visibleProcurements.map((bid) => (
              <li
                key={bid.workspace_id}
                className="flex items-center justify-between py-2"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/procurement/${bid.workspace_id}`}
                    className="text-sm font-medium text-foreground hover:text-primary"
                  >
                    {bid.workspace_name}
                  </Link>
                  {bid.buyer && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {bid.buyer}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <OutcomeBadge outcome={bid.outcome} />
                  <span className="text-xs text-muted-foreground">
                    {formatDateUK(bid.cited_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {hasMore && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
              type="button"
            >
              <ChevronDown className="size-3" aria-hidden="true" />
              Show all ({data.bids.length})
            </button>
          )}
        </div>
      )}
    </section>
  );
}
