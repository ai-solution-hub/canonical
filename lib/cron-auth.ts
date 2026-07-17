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
 * Verify that a request from the cocoindex pipeline sidecar carries a valid
 * pipeline-trigger secret (ID-127.18, S436 D1 — splits the pipeline-sidecar
 * boundary off the Vercel-cron-only `CRON_SECRET`).
 *
 * RETIRED DUAL-ACCEPT (ID-127.18 PLAN §6 step 6, S457 owner ratification):
 * the rotation window is over — `PIPELINE_TRIGGER_SECRET` is now the SOLE
 * bearer this boundary accepts. The legacy `CRON_SECRET` fallback has been
 * removed; a bearer matching the (now-retired) shared secret no longer
 * authenticates here.
 *
 * Guards ONLY the pipeline<->app boundary — currently the inbound
 * `/api/internal/pipeline-runs/record` webhook from the sidecar. Vercel Cron
 * routes (`/api/cron/*`) stay on `verifyCronAuth` (CRON_SECRET only); this
 * function does not affect their contract.
 *
 * Fails closed (returns false) if PIPELINE_TRIGGER_SECRET is unset.
 */
export function verifyPipelineTriggerAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const pipelineTriggerSecret = process.env.PIPELINE_TRIGGER_SECRET;

  if (!pipelineTriggerSecret) {
    logger.error('PIPELINE_TRIGGER_SECRET environment variable not set');
    return false;
  }

  return authHeader === `Bearer ${pipelineTriggerSecret}`;
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
