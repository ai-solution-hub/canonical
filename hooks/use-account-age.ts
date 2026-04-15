'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

/**
 * Query key for the current user's account age — kept local because it is
 * only consumed here and by its test file.
 */
const ACCOUNT_AGE_QUERY_KEY = ['user', 'account-age'] as const;

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
 */
export function useAccountAge(): UseAccountAgeResult {
  const { data, isLoading } = useQuery({
    queryKey: ACCOUNT_AGE_QUERY_KEY,
    queryFn: async (): Promise<{ hours: number | null }> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const createdAt = user?.created_at ?? null;
      // `Date.now()` lives inside the queryFn (not the render path) so the
      // hook stays pure per react-hooks/purity. The returned value is
      // frozen for the session via `staleTime: Infinity`.
      const hours = createdAt
        ? (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
        : null;
      return { hours };
    },
    // Account age is a stable property of the session — we never need to
    // refetch it within a tab lifetime.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const hours = data?.hours ?? null;

  return {
    hours,
    isOver24h: hours !== null && hours >= 24,
    isNewAccount: hours !== null && hours < 24,
    loading: isLoading,
  };
}
