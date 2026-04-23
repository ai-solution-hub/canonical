'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/query-keys';
import type { PrimaryFocus } from '@/lib/user-focus-constants';

const VALID_FOCUS_VALUES: ReadonlySet<string> = new Set([
  'bid_writing',
  'account_management',
  'marketing',
]);

export interface UsePrimaryFocusResult {
  /** The user's selected primary focus, or null if unset / unauthenticated. */
  primaryFocus: PrimaryFocus | null;
  /** True while the auth data is being fetched. */
  isLoading: boolean;
}

/**
 * Reads `user_metadata.primary_focus` from Supabase Auth for the current
 * session. Fulfils the P0-4 Phase 2 client hook contract (spec section 5.1).
 *
 * Returns `null` when the user has not selected a focus or is unauthenticated.
 * The value is written by the P0-4 DashboardFirstRunCard persona hint row
 * or the Settings profile dropdown.
 */
export function usePrimaryFocus(): UsePrimaryFocusResult {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.user.primaryFocus,
    queryFn: async (): Promise<{ primaryFocus: PrimaryFocus | null }> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return { primaryFocus: null };

      const raw = user.user_metadata?.primary_focus;
      if (typeof raw === 'string' && VALID_FOCUS_VALUES.has(raw)) {
        return { primaryFocus: raw as PrimaryFocus };
      }

      return { primaryFocus: null };
    },
    // primary_focus is immutable for a session — no need to refetch.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    primaryFocus: data?.primaryFocus ?? null,
    isLoading,
  };
}
