'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { UserRole } from '@/lib/roles';

export function useUserRole() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      setRole((data?.role as UserRole) ?? 'viewer');
      setLoading(false);
    }
    fetchRole();
  }, []);

  return {
    role,
    loading,
    canEdit: role === 'admin' || role === 'editor',
    canAdmin: role === 'admin',
  };
}
