/**
 * Shared cron authentication and recipient resolution.
 *
 * Vercel cron jobs send `Authorization: Bearer <CRON_SECRET>`.
 * Cron routes must verify this header before executing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger';

/**
 * Verify that the request carries a valid cron secret.
 * Returns false if CRON_SECRET is not configured or the header does not match.
 */
export function verifyCronAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error('CRON_SECRET environment variable not set');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Fetch user IDs that hold any of the given roles.
 * Used to resolve notification recipients for cron-generated alerts.
 */
export async function getUsersByRole(
  supabase: SupabaseClient<Database>,
  roles: string[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .in('role', roles);

  if (error) {
    logger.error({ err: error }, 'Failed to fetch users by role');
    return [];
  }

  return (data ?? []).map((r) => r.user_id);
}
