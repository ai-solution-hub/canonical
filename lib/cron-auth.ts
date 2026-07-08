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
 * ROTATION-SAFE DUAL-ACCEPT: accepts EITHER the dedicated
 * `PIPELINE_TRIGGER_SECRET` OR the legacy shared `CRON_SECRET`, so the
 * sidecar keeps authenticating through the env rollout window before every
 * pipeline Coolify app + Vercel deployment has the new secret set. Once the
 * rollout's retire-shared step lands (all 4 pipeline apps + Vercel updated),
 * drop the `CRON_SECRET` branch here.
 *
 * Guards ONLY the pipeline<->app boundary — currently the inbound
 * `/api/internal/pipeline-runs/record` webhook from the sidecar. Vercel Cron
 * routes (`/api/cron/*`) stay on `verifyCronAuth` (CRON_SECRET only); this
 * function does not affect their contract.
 *
 * Fails closed (returns false) if BOTH secrets are unset.
 */
export function verifyPipelineTriggerAuth(request: Request): boolean {
  const authHeader = request.headers.get('authorization');
  const pipelineTriggerSecret = process.env.PIPELINE_TRIGGER_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  if (!pipelineTriggerSecret && !cronSecret) {
    logger.error(
      'PIPELINE_TRIGGER_SECRET and CRON_SECRET environment variables both unset',
    );
    return false;
  }

  if (
    pipelineTriggerSecret &&
    authHeader === `Bearer ${pipelineTriggerSecret}`
  ) {
    return true;
  }

  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
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
