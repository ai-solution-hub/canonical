'use client';

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiringItem {
  id: string;
  title: string;
  expiry_date: string;
  primary_domain: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the number of days remaining until an expiry date.
 * Returns a negative number for dates that have already passed.
 */
function daysRemaining(expiryDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Format an ISO date as DD/MM/YYYY for UK display.
 */
function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB');
}

/**
 * Get the urgency level based on days remaining.
 * - expired: already past
 * - imminent: 7 days or fewer
 * - approaching: more than 7 days
 */
function getUrgency(days: number): 'expired' | 'imminent' | 'approaching' {
  if (days <= 0) return 'expired';
  if (days <= 7) return 'imminent';
  return 'approaching';
}

/**
 * Get CSS classes for urgency-based visual treatment.
 * Uses semantic freshness tokens — never raw Tailwind colours.
 */
function urgencyClasses(urgency: 'expired' | 'imminent' | 'approaching'): {
  badge: string;
  text: string;
} {
  switch (urgency) {
    case 'expired':
      return {
        badge: 'bg-freshness-expired-bg text-freshness-expired',
        text: 'text-freshness-expired',
      };
    case 'imminent':
      return {
        badge: 'bg-freshness-stale-bg text-freshness-stale',
        text: 'text-freshness-stale',
      };
    case 'approaching':
      return {
        badge: 'bg-freshness-aging-bg text-freshness-aging',
        text: 'text-freshness-aging',
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ExpiringContentSectionProps {
  /** Callback when expiring count is determined — used by parent for attention items */
  onExpiringCountChange?: (count: number) => void;
}

/**
 * Dashboard section showing content items expiring within the next 30 days.
 *
 * Fetches content items where expiry_date is set and within the 30-day window.
 * Sorted by expiry date (soonest first). Uses freshness semantic tokens for
 * urgency visual treatment.
 */
export function ExpiringContentSection({
  onExpiringCountChange,
}: ExpiringContentSectionProps) {
  const [items, setItems] = useState<ExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch items with expiry_date within the next 30 days
        const thirtyDaysFromNow = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        const response = await fetch(
          `/api/items?expiry_before=${encodeURIComponent(thirtyDaysFromNow)}&has_expiry=true&archived=false&limit=20`,
        );

        if (!response.ok) {
          throw new Error('Failed to load expiring content data');
        }

        const data = await response.json();
        const expiringItems: ExpiringItem[] = (data.items ?? data ?? [])
          .filter((item: ExpiringItem) => item.expiry_date)
          .sort(
            (a: ExpiringItem, b: ExpiringItem) =>
              new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime(),
          );

        if (!cancelled) {
          setItems(expiringItems);
          onExpiringCountChange?.(expiringItems.length);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load expiring content data',
          );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <section
        aria-label="Expiring content"
        className="rounded-lg border border-border bg-card p-4"
      >
        <div className="flex items-center gap-2">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mt-3 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (error) {
    return (
      <section
        aria-label="Expiring content"
        className="rounded-lg border border-border bg-card p-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock className="size-4" aria-hidden="true" />
          Expiring Content
        </h2>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <AlertTriangle
            className="size-4 shrink-0 text-status-warning"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            Could not load expiring content data. Try refreshing the page.
          </p>
        </div>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Empty state — no items expiring
  // -------------------------------------------------------------------------

  if (items.length === 0) {
    return (
      <section
        aria-label="Expiring content"
        className="rounded-lg border border-border bg-card p-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock className="size-4" aria-hidden="true" />
          Expiring Content
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          No content expiring in the next 30 days.
        </p>
      </section>
    );
  }

  // -------------------------------------------------------------------------
  // Render — items expiring within 30 days
  // -------------------------------------------------------------------------

  const expiredCount = items.filter((item) => daysRemaining(item.expiry_date) <= 0).length;
  const imminentCount = items.filter((item) => {
    const days = daysRemaining(item.expiry_date);
    return days > 0 && days <= 7;
  }).length;

  return (
    <section
      aria-label="Expiring content"
      id="expiring-content"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="size-4" aria-hidden="true" />
        Expiring Content
        {items.length > 0 && (
          <span
            className="ml-1 inline-flex items-center rounded-full bg-freshness-aging-bg px-2 py-0.5 text-xs font-medium text-freshness-aging"
            aria-label={`${items.length} items expiring`}
          >
            {items.length}
          </span>
        )}
      </h2>

      {/* Summary badges */}
      {(expiredCount > 0 || imminentCount > 0) && (
        <div className="mb-3 flex flex-wrap gap-2" role="status">
          {expiredCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-freshness-expired-bg px-2 py-0.5 text-xs font-medium text-freshness-expired">
              {expiredCount} expired
            </span>
          )}
          {imminentCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-freshness-stale-bg px-2 py-0.5 text-xs font-medium text-freshness-stale">
              {imminentCount} within 7 days
            </span>
          )}
        </div>
      )}

      <ul className="space-y-2" role="list">
        {items.map((item) => {
          const days = daysRemaining(item.expiry_date);
          const urgency = getUrgency(days);
          const classes = urgencyClasses(urgency);

          return (
            <li
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/items/${item.id}`}
                  className="text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {item.title}
                </Link>
                {item.primary_domain && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {item.primary_domain}
                  </span>
                )}
              </div>

              <div className="ml-4 flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {formatDate(item.expiry_date)}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes.badge}`}
                >
                  {days <= 0
                    ? 'Expired'
                    : days === 1
                      ? '1 day'
                      : `${days} days`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
