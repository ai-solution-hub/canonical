'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

/**
 * Query key for the current user's account age — kept local because it is
 * only consumed here and by its test file.
 */
const ACCOUNT_AGE_QUERY_KEY = ['user', 'account-age'] as const;

/** @public */
export interface UseAccountAgeResult {
  /** Hours since `auth.users.created_at`, or `null` while loading / logged out. */
  hours: number | null;
  /** `true` once we have an age and it is >= 24h. `false` for new accounts. */
  isOver24h: boolean;
  /** `true` only if we have a user and the account is strictly < 24h old. */
  isNewAccount: boolean;
  loading: boolean;
}

/**
 * Reads `auth.users.created_at` for the current session and computes the
 * account age in hours. Used by `/digest` to gate first-visit auto-generation
 * for accounts that are less than 24 hours old (P0-11).
 *
 * Returns `{ hours: null, isOver24h: false, loading: true }` until Supabase
 * resolves. Unauthenticated sessions settle to `{ hours: null, isOver24h:
 * false, loading: false }`.
 *
 * Implementation note: the TanStack Query cache stores the immutable
 * `created_at` ISO string (not a precomputed `hours` number). The derivation
 * `Date.now() - createdAt` runs in the hook body on every render — so the
 * boolean flags always reflect the current wall-clock time, even if the user
 * keeps a tab open across the 24h boundary. The fetch itself uses
 * `staleTime: Infinity` because `created_at` never changes for a given
 * session; we only need to read it once per tab lifetime.
 */
export function useAccountAge(): UseAccountAgeResult {
  const { data, isLoading } = useQuery({
    queryKey: ACCOUNT_AGE_QUERY_KEY,
    queryFn: async (): Promise<{ createdAt: string | null }> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return { createdAt: user?.created_at ?? null };
    },
    // `created_at` is immutable for a session — no need to refetch.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const createdAt = data?.createdAt ?? null;
  // Intentional: we read `Date.now()` during render so that `isOver24h`
  // flips correctly as soon as the 24h boundary is crossed, without a
  // cache flush. `createdAt` is immutable, so the only cross-render
  // instability is the wall-clock reading — which is the behaviour we
  // want here. Suppressing `react-hooks/purity` deliberately, consistent
  // with the lazy-initialiser pattern in `app/change-reports/page.tsx`.
  /* eslint-disable react-hooks/purity */
  const hours = createdAt
    ? (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
    : null;
  /* eslint-enable react-hooks/purity */

  return {
    hours,
    isOver24h: hours !== null && hours >= 24,
    isNewAccount: hours !== null && hours < 24,
    loading: isLoading,
  };
}
