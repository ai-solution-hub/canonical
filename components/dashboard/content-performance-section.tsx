'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { DomainBadge } from '@/components/shared/domain-badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainStats {
  domain: string;
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  unique_items_cited: number;
  unique_bids: number;
}

interface OverallStats {
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
  unique_items_cited: number;
  unique_bids: number;
}

interface AggregateWinRateData {
  overall: OverallStats;
  by_domain: DomainStats[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the Warm Meridian bar colour class for the given win rate (0-1 decimal) */
function getWinRateBarClass(winRate: number): string {
  const pct = winRate * 100;
  if (pct >= 70) return 'bg-freshness-fresh';
  if (pct >= 40) return 'bg-freshness-aging';
  return 'bg-freshness-stale';
}

/** Returns the text colour class for the given win rate, or muted if no decided bids */
function getWinRateTextClass(
  winRate: number,
  hasDecidedOutcomes: boolean,
): string {
  if (!hasDecidedOutcomes) return 'text-muted-foreground';
  const pct = winRate * 100;
  if (pct >= 70) return 'text-freshness-fresh';
  if (pct >= 40) return 'text-freshness-aging';
  return 'text-freshness-stale';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Content Performance dashboard section — aggregate win-rate analytics.
 *
 * Shows overall metrics (win rate, citations, bids, items) and per-domain
 * breakdown with win-rate bars. Handles cold-start with an explainer.
 *
 * Fetches data client-side to avoid blocking the server-rendered dashboard.
 */
export function ContentPerformanceSection() {
  const [data, setData] = useState<AggregateWinRateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/analytics/win-rate');

        if (!response.ok) {
          throw new Error('Failed to load performance data');
        }

        const result: AggregateWinRateData = await response.json();
        if (!cancelled) {
          setData(result);
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load content performance data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Loading state ---
  if (loading) {
    return (
      <section
        className="rounded-lg border border-border bg-card p-4"
        aria-label="Content performance"
        aria-busy="true"
      >
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Content Performance
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </section>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <section
        className="rounded-lg border border-border bg-card p-4"
        aria-label="Content performance"
      >
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Content Performance
        </h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    );
  }

  // --- Empty state (cold start) ---
  if (!data || data.overall.total_citations === 0) {
    return (
      <section
        className="rounded-lg border border-border bg-card p-4"
        aria-label="Content performance"
      >
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Content Performance
        </h2>
        <p className="text-sm text-muted-foreground">
          No bid performance data yet. Win rate analytics will appear here once
          content is cited in bid responses and outcomes are recorded.
        </p>
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">
            How it works:
          </p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5 text-xs text-muted-foreground">
            <li>Draft bid responses using KB content</li>
            <li>Record bid outcomes (won/lost) on the bid detail page</li>
            <li>Performance metrics accumulate automatically</li>
          </ol>
        </div>
      </section>
    );
  }

  const { overall, by_domain } = data;
  const hasDecidedOutcomes =
    overall.winning_citations + overall.losing_citations > 0;
  const winRatePct = Math.round(overall.win_rate * 100);

  return (
    <section
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-label="Content performance"
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Content Performance
      </h2>

      {/* Overall metrics row */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">
          Overall
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p
              className={`text-2xl font-bold ${getWinRateTextClass(overall.win_rate, hasDecidedOutcomes)}`}
            >
              {hasDecidedOutcomes ? `${winRatePct}%` : '---'}
            </p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-2xl font-bold text-foreground">
              {overall.total_citations}
            </p>
            <p className="text-xs text-muted-foreground">Citations</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-2xl font-bold text-foreground">
              {overall.unique_bids}
            </p>
            <p className="text-xs text-muted-foreground">Bids</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-2xl font-bold text-foreground">
              {overall.unique_items_cited}
            </p>
            <p className="text-xs text-muted-foreground">Items</p>
          </div>
        </div>
      </div>

      {/* Domain breakdown */}
      {by_domain.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">
            By Domain
          </h3>
          <div className="space-y-3">
            {by_domain.map((domain) => {
              const domainDecided =
                domain.winning_citations + domain.losing_citations > 0;
              const domainPct = Math.round(domain.win_rate * 100);

              return (
                <div key={domain.domain} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <DomainBadge domain={domain.domain} />
                  </div>
                  <div className="flex-1">
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="meter"
                      aria-valuenow={domainDecided ? domainPct : 0}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${domain.domain} win rate`}
                    >
                      {domainDecided && (
                        <div
                          className={`h-full rounded-full transition-all ${getWinRateBarClass(domain.win_rate)}`}
                          style={{ width: `${domainPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <span className="w-10 shrink-0 text-right text-sm font-medium text-foreground">
                    {domainDecided ? `${domainPct}%` : '---'}
                  </span>
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                    {domain.total_citations} citation
                    {domain.total_citations !== 1 ? 's' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending citations note */}
      {overall.pending_citations > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {overall.pending_citations} citation
          {overall.pending_citations !== 1 ? 's' : ''} in bids awaiting outcome
        </p>
      )}
    </section>
  );
}
