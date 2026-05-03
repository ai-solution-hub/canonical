/**
 * Auth-context re-validation for queue workers — Session 222 Wave 2-A.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §4.2
 * (lines 580-614). Plan source:
 * `docs/plans/background-queue-infra-plan.md` §1 W2, §2 W2-A.
 *
 * The `payload.auth_context.role` stored on a queue row is a SNAPSHOT
 * taken at enqueue time. Between enqueue and worker processing the
 * user's role in `user_roles` may have changed (admin → editor
 * demotion, role revocation on staff change). The worker MUST re-fetch
 * the live role and refuse to proceed if the live role is lower than
 * the role required by the job-type.
 *
 * Cross-runtime LCD compliance: this module imports only types and the
 * Supabase client interface — no top-level Node-only imports — so it
 * stays usable from any runtime that already holds a SupabaseClient
 * (per `feedback_chokepoint_cross_runtime`).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';

const ROLE_RANK: Record<'admin' | 'editor' | 'viewer', number> = {
  admin: 3,
  editor: 2,
  viewer: 1,
};

function rolesAreLowerThan(
  current: 'admin' | 'editor' | 'viewer',
  required: 'admin' | 'editor',
): boolean {
  return ROLE_RANK[current] < ROLE_RANK[required];
}

/**
 * Re-validates the auth context snapshot stored in the queue envelope
 * against the live `user_roles` row. Per spec §4.2: between enqueue and
 * worker processing the user's role may have changed; the worker must
 * refuse to proceed with a stale snapshot if the live role is lower than
 * the job-type's required minimum.
 *
 * Returns `{ ok: true }` when the live role meets or exceeds
 * `requiredRole`; otherwise returns `{ ok: false, reason }` with a
 * caller-formattable string. The caller (the cron worker / per-job
 * handler) sets `status='failed', error_message=reason` with NO retry
 * (role demotion is permanent until manually reversed).
 *
 * @see docs/specs/background-queue-infra-spec.md §4.2 lines 587-610
 */
export async function reValidateAuthContext(
  serviceClient: SupabaseClient<Database>,
  userId: string,
  enqueuedRole: 'admin' | 'editor' | 'viewer',
  requiredRole: 'admin' | 'editor',
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await serviceClient
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error)
    return { ok: false, reason: `role_lookup_failed: ${error.message}` };
  if (!data) return { ok: false, reason: 'enqueueing user has no role record' };
  const currentRole = data.role as 'admin' | 'editor' | 'viewer';
  if (rolesAreLowerThan(currentRole, requiredRole)) {
    return {
      ok: false,
      reason: `enqueueing user role no longer authorised: enqueued=${enqueuedRole}, current=${currentRole}, required=${requiredRole}`,
    };
  }
  return { ok: true };
}
