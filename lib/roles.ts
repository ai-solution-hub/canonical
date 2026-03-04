import { createClient } from '@/lib/supabase/server';

export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * Get the current authenticated user's application role.
 * Returns 'viewer' if the user has no role entry (safe default matching RLS behaviour).
 * Returns null if the user is not authenticated.
 */
export async function getCurrentUserRole(): Promise<UserRole | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  return (data?.role as UserRole) ?? 'viewer';
}

export function canEdit(role: UserRole | null): boolean {
  return role === 'admin' || role === 'editor';
}

export function canAdmin(role: UserRole | null): boolean {
  return role === 'admin';
}
