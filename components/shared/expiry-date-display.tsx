'use client';

import { cn } from '@/lib/utils';
import { useHydrated } from '@/hooks/use-hydrated';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiryDateDisplayProps {
  /** ISO 8601 date string for the expiry date */
  expiryDate: string;
  /** Lifecycle type of the content item (e.g. 'date_bound') */
  lifecycleType: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the number of days remaining until an expiry date.
 * Returns a negative number for dates that have already passed.
 */
function daysRemaining(expiryDate: string): number {
  const now = new Date(Date.now());
  now.setHours(0, 0, 0, 0);
  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Format an ISO date as DD/MM/YYYY for UK display.
 */
function formatDateUK(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB');
}

/**
 * Get urgency level and styling based on days remaining.
 * Uses semantic freshness tokens (never raw Tailwind colours).
 */
function getExpiryUrgency(days: number): {
  label: string;
  badgeClass: string;
  textClass: string;
} {
  if (days <= 0) {
    return {
      label: 'Expired',
      badgeClass: 'bg-freshness-expired-bg text-freshness-expired',
      textClass: 'text-freshness-expired',
    };
  }
  if (days <= 7) {
    return {
      label: `${days} day${days === 1 ? '' : 's'} remaining`,
      badgeClass: 'bg-freshness-stale-bg text-freshness-stale',
      textClass: 'text-freshness-stale',
    };
  }
  if (days <= 30) {
    return {
      label: `${days} days remaining`,
      badgeClass: 'bg-freshness-aging-bg text-freshness-aging',
      textClass: 'text-freshness-aging',
    };
  }
  return {
    label: `${days} days remaining`,
    badgeClass: 'bg-freshness-fresh-bg text-freshness-fresh',
    textClass: 'text-freshness-fresh',
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Displays the expiry date of a content item with urgency-based styling.
 *
 * Shows:
 * - The expiry date formatted as DD/MM/YYYY
 * - A coloured urgency indicator (using freshness semantic tokens)
 * - The lifecycle type when it is 'date_bound'
 * - An accessible description for screen readers
 *
 * Colour is never the sole indicator of urgency: the textual label
 * (e.g. "Expired", "7 days remaining") conveys the same information.
 */
export function ExpiryDateDisplay({
  expiryDate,
  lifecycleType,
}: ExpiryDateDisplayProps) {
  const mounted = useHydrated();

  // Inert structural placeholder during SSR/pre-mount to preserve the
  // surrounding <dl> layout (parent metadata sidebar). The urgency
  // calculation depends on "today" so we cannot render the live value
  // until the client has mounted — this prevents a hydration text
  // mismatch between server-rendered and client-rendered urgency labels.
  if (!mounted) {
    return (
      <>
        <div>
          <dt className="text-xs text-muted-foreground">Expiry Date</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums text-muted-foreground">—</span>
          </dd>
        </div>
        {lifecycleType === 'date_bound' && (
          <div>
            <dt className="text-xs text-muted-foreground">Lifecycle</dt>
            <dd className="text-foreground">Date-bound</dd>
          </div>
        )}
      </>
    );
  }

  const days = daysRemaining(expiryDate);
  const urgency = getExpiryUrgency(days);

  return (
    <>
      <div>
        <dt className="text-xs text-muted-foreground">Expiry Date</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="text-foreground">{formatDateUK(expiryDate)}</span>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              urgency.badgeClass,
            )}
            role="status"
            aria-label={`Expiry status: ${urgency.label}`}
          >
            {urgency.label}
          </span>
        </dd>
      </div>
      {lifecycleType === 'date_bound' && (
        <div>
          <dt className="text-xs text-muted-foreground">Lifecycle</dt>
          <dd className="text-foreground">Date-bound</dd>
        </div>
      )}
    </>
  );
}
