'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { createClient } from '@/lib/supabase/client';
import { SupabaseError } from '@/lib/supabase/safe';
import type { UserRole } from '@/lib/roles';

/**
 * PostgREST's "no rows returned" code for a `.single()` read. It is the ONLY
 * error code that means "no role row exists"; every other code (RLS denial,
 * connection failure, statement timeout) is a genuine failure.
 */
const PGRST_NO_ROWS = 'PGRST116';

/**
 * Fetches the current user's role from the `user_roles` table via TanStack Query.
 *
 * Replaces the manual useState+useEffect pattern with a single useQuery call.
 * Returns `null` role when unauthenticated, defaults to `'viewer'` when no
 * role row exists. A real query failure throws so TanStack Query surfaces an
 * error state instead of silently downgrading the user to viewer.
 */
export function useUserRole() {
  const {
    data: role = null,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.user.role,
    queryFn: async (): Promise<UserRole | null> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      // id-369 F2: the old blanket `?? 'viewer'` doubled as the error
      // default, so a transient DB error silently downgraded an admin to
      // viewer. Only a real failure is an error — PGRST116 ("no rows")
      // means the user simply has no role row yet.
      if (roleError && roleError.code !== PGRST_NO_ROWS) {
        throw new SupabaseError(roleError, 'user.role');
      }

      // Some clients (and the unit-test doubles) signal a miss as
      // `{ data: null, error: null }` rather than PGRST116 — still an
      // absence (id-327 carve-out), so the viewer default applies.
      return (data?.role as UserRole) ?? 'viewer';
    },
  });

  return {
    role,
    loading,
    error,
    canEdit: role === 'admin' || role === 'editor',
    canAdmin: role === 'admin',
  };
}
