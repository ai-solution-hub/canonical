'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/roles';

/**
 * Fetches the current user's role from the `user_roles` table via TanStack Query.
 *
 * Replaces the manual useState+useEffect pattern with a single useQuery call.
 * Returns `null` role when unauthenticated, defaults to `'viewer'` when no
 * role row exists.
 */
export function useUserRole() {
  const { data: role = null, isLoading: loading } = useQuery({
    queryKey: queryKeys.user.role,
    queryFn: async (): Promise<UserRole | null> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      return (data?.role as UserRole) ?? 'viewer';
    },
  });

  return {
    role,
    loading,
    canEdit: role === 'admin' || role === 'editor',
    canAdmin: role === 'admin',
  };
}
