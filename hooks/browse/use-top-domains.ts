'use client';

/**
 * useTopDomains — fetches the N most-populated `primary_domain` values from
 * `content_items`, used to seed the "Browse by domain" ChipComposite card
 * on the Browse cold-start view (spec §1.20, D-15 + D-16).
 *
 * Reuses the existing `get_filter_counts` RPC (already consumed by
 * `useFilterData` for the filter panel). The RPC returns per-domain item
 * counts keyed by the raw `primary_domain` slug; this hook converts that
 * into a ranked list and keeps only the top `limit` slugs whose count
 * meets the minimum-population floor (`MIN_DOMAIN_COUNT`, default 20).
 *
 * Cache strategy — D-16 (locked 2026-04-24):
 *   - staleTime: 24h — chips reflect yesterday's item counts on next
 *     mount. Acceptable for a product-discoverability surface.
 *   - gcTime: 24h — keeps the cache warm for navigation.
 *
 * RLS — the RPC runs as SECURITY INVOKER (per Supabase default for
 * Postgres functions without an explicit override) and therefore
 * reflects the caller's visible item set. Chips on cold-start
 * therefore lead to a landing page that IS populated for the clicking
 * user, which is the correct discoverability behaviour.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { parseJsonb, FilterCountsSchema } from '@/lib/validation/jsonb';

/**
 * Minimum item count for a domain to qualify as a chip. Below this, the
 * chip is elided (user never sees an under-populated chip on cold-start).
 */
const MIN_DOMAIN_COUNT = 20;

/**
 * 24h stale/gc-time. D-16 decision — locked 2026-04-24.
 * Extracted as a constant for test override via the TanStack Query wrapper.
 */
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/** Shared query key for the top-domains aggregate (mirrors `filters.counts`). */
const TOP_DOMAINS_QUERY_KEY = ['browse', 'top-domains'] as const;

function getSupabase() {
  return createClient();
}

async function fetchTopDomains(): Promise<
  ReadonlyArray<{ domain: string; count: number }>
> {
  const { data, error } = await getSupabase().rpc('get_filter_counts');
  if (error || !data) {
    // Log but do not throw — the consumer falls back to taxonomy-context
    // domain names (spec §6.2 step 4).
    if (error) {
      console.error('Failed to fetch top domains:', error.message);
    }
    return [];
  }

  const parsed = parseJsonb(FilterCountsSchema, data);
  const domainCounts = parsed?.domain ?? {};

  return Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count: Number(count) }))
    .filter((row) => row.count >= MIN_DOMAIN_COUNT)
    .sort((a, b) => b.count - a.count);
}

interface UseTopDomainsResult {
  /** Sorted top-N domains ({domain, count}), filtered to count ≥ 20. */
  domains: ReadonlyArray<{ domain: string; count: number }>;
  /** True while the initial fetch is in flight. */
  isLoading: boolean;
  /** True on a network/RPC error — consumer should fall back to taxonomy. */
  isError: boolean;
}

/**
 * @param limit — how many top domains to return (3 for the default
 * chip composite card). Applied after sorting; consumers requesting
 * `limit=3` get at most 3 chips even when more qualify.
 */
export function useTopDomains(limit: number): UseTopDomainsResult {
  const query = useQuery({
    queryKey: TOP_DOMAINS_QUERY_KEY,
    queryFn: fetchTopDomains,
    staleTime: TWENTY_FOUR_HOURS_MS,
    gcTime: TWENTY_FOUR_HOURS_MS,
  });

  const domains = useMemo(() => {
    const data = query.data ?? [];
    return data.slice(0, limit);
  }, [query.data, limit]);

  return {
    domains,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
