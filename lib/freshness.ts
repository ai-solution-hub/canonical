/**
 * Deterministic freshness calculation for content items.
 *
 * Rules are based on lifecycle_type:
 * - evergreen: fresh <12mo, aging 12-18mo, stale 18-24mo, expired >24mo
 * - date_bound: fresh if expiry >3mo away, aging 1-3mo, stale <1mo, expired past
 * - regulation: fresh <6mo, aging 6-9mo, stale 9-12mo, expired >12mo
 * - bid_discovered: always fresh (refreshed per bid)
 * - null/default: use evergreen rules
 */

export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'expired';
export type LifecycleType = 'evergreen' | 'date_bound' | 'regulation' | 'bid_discovered';

interface FreshnessInput {
  lifecycle_type: LifecycleType | string | null;
  updated_at: string | null;
  expiry_date: string | null;
}

/**
 * Calculate the number of months between two dates.
 * Returns a positive number if `from` is before `to`.
 */
function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth()) +
    (to.getDate() - from.getDate()) / 30
  );
}

/**
 * Calculate freshness for evergreen content based on time since last update.
 */
function calculateEvergreenFreshness(
  updatedAt: Date,
  now: Date,
): FreshnessState {
  const monthsAgo = monthsBetween(updatedAt, now);

  if (monthsAgo < 12) return 'fresh';
  if (monthsAgo < 18) return 'aging';
  if (monthsAgo < 24) return 'stale';
  return 'expired';
}

/**
 * Calculate freshness for date-bound content based on expiry date.
 */
function calculateDateBoundFreshness(
  expiryDate: Date | null,
  now: Date,
): FreshnessState {
  if (!expiryDate) {
    // No expiry date set -- treat as evergreen-ish, default to aging
    return 'aging';
  }

  const monthsUntilExpiry = monthsBetween(now, expiryDate);

  if (monthsUntilExpiry < 0) return 'expired';
  if (monthsUntilExpiry < 1) return 'stale';
  if (monthsUntilExpiry < 3) return 'aging';
  return 'fresh';
}

/**
 * Calculate freshness for regulation content based on time since last update.
 */
function calculateRegulationFreshness(
  updatedAt: Date,
  now: Date,
): FreshnessState {
  const monthsAgo = monthsBetween(updatedAt, now);

  if (monthsAgo < 6) return 'fresh';
  if (monthsAgo < 9) return 'aging';
  if (monthsAgo < 12) return 'stale';
  return 'expired';
}

/**
 * Calculate the freshness state for a content item.
 *
 * @param input - The item's lifecycle type, last update time, and optional expiry date
 * @param now - Override the current date (for testing)
 * @returns The calculated freshness state
 */
export function calculateFreshness(
  input: FreshnessInput,
  now: Date = new Date(),
): FreshnessState {
  const { lifecycle_type, updated_at, expiry_date } = input;

  // bid_discovered is always fresh
  if (lifecycle_type === 'bid_discovered') {
    return 'fresh';
  }

  // date_bound uses expiry date
  if (lifecycle_type === 'date_bound') {
    const expiry = expiry_date ? new Date(expiry_date) : null;
    return calculateDateBoundFreshness(expiry, now);
  }

  // For evergreen, regulation, and null/default, we need an update date
  const lastUpdate = updated_at ? new Date(updated_at) : null;
  if (!lastUpdate) {
    // No update date -- can't calculate, assume stale
    return 'stale';
  }

  if (lifecycle_type === 'regulation') {
    return calculateRegulationFreshness(lastUpdate, now);
  }

  // Default: evergreen rules (including null lifecycle_type)
  return calculateEvergreenFreshness(lastUpdate, now);
}

/**
 * Batch calculate freshness for multiple items.
 * Returns a map of item ID to freshness state.
 */
export function batchCalculateFreshness(
  items: Array<{
    id: string;
    lifecycle_type: string | null;
    updated_at: string | null;
    expiry_date: string | null;
  }>,
  now: Date = new Date(),
): Map<string, FreshnessState> {
  const results = new Map<string, FreshnessState>();
  for (const item of items) {
    results.set(
      item.id,
      calculateFreshness(
        {
          lifecycle_type: item.lifecycle_type,
          updated_at: item.updated_at,
          expiry_date: item.expiry_date,
        },
        now,
      ),
    );
  }
  return results;
}
