/**
 * Batch user display-name resolution.
 *
 * Shipped as part of S156 WP-2 to replace the `auth.admin.getUserById`-
 * in-loop pattern in three production routes:
 *   - app/api/users/display-names/route.ts
 *   - app/api/content-owners/stats/route.ts
 *   - lib/reorient.ts:resolveDisplayNames
 *
 * The old pattern had two flaws:
 *   1. **S156-class silent degradation** — `Promise.allSettled` around a
 *      GoTrue admin call swallowed the error silently when the pipeline
 *      service account row was missing its 8 token columns (the root
 *      cause of the S156 incident). Every screen that resolved display
 *      names for pipeline-owned content fell back to "A team member"
 *      and Sentry never saw it.
 *   2. **N+1** — one sequential round trip per user, flagged in the
 *      March 2026 code review.
 *
 * Both are closed by a single SQL round trip via
 * `public.get_user_display_names(uuid[])` (SECURITY DEFINER, GRANTed to
 * `authenticated` + `service_role`). The function guarantees exactly one
 * row per input UUID (it projects `req.id` from `unnest(user_ids)`, not
 * the LEFT JOIN result — see migration comment for C-1 context) and
 * hard-codes `'Pipeline (system)'` for the pipeline service account.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

export interface UserDisplayInfo {
  user_id: string;
  display_name: string;
  email: string | null;
}

/**
 * Resolve a batch of user UUIDs to display names in a single round trip.
 *
 * - Pipeline service account always resolves to `'Pipeline (system)'`.
 * - Unknown UUIDs always resolve to `'A team member'` (the SQL function
 *   guarantees a row per requested UUID).
 * - Duplicate UUIDs in the input array are collapsed to a single Map
 *   entry (the wrapper dedupes via `new Set()` before the RPC call).
 *
 * Safe to call from any authenticated context — both user-scoped and
 * service-role clients work, because the underlying function is
 * GRANTed to `authenticated` and `service_role`.
 *
 * Returns a Map keyed by `user_id` for O(1) lookup at call sites.
 * The Map is empty for an empty input array (short-circuits without
 * calling the DB).
 *
 * @throws Error if the underlying RPC call fails (network, permission,
 *   or SQL error). Callers should wrap in try/catch if silent degradation
 *   is acceptable — but note that silent degradation was exactly the
 *   problem S156 closed. Prefer surfacing the error.
 */
export async function resolveUserDisplayNames(
  supabase: SupabaseClient<Database>,
  userIds: readonly string[],
): Promise<Map<string, UserDisplayInfo>> {
  const result = new Map<string, UserDisplayInfo>();
  if (userIds.length === 0) return result;

  const uniqueIds = [...new Set(userIds)];

  const { data, error } = await supabase.rpc('get_user_display_names', {
    user_ids: uniqueIds,
  });

  if (error) {
    throw new Error(`get_user_display_names failed: ${error.message}`);
  }

  // The SQL function guarantees one row per requested UUID with a
  // non-NULL user_id (it projects from `unnest(user_ids)`, not from the
  // LEFT JOIN result — see WP-2 SQL function comment and C-1 in the
  // spec verification report). The `display_name` column is also non-
  // NULL because the CASE/COALESCE chain terminates in the literal
  // `'A team member'`. We still guard with `?? 'A team member'` for
  // defence in depth — if the function is ever modified to return
  // NULL, we fail open rather than inserting a NULL into a Map<string>.
  for (const row of data ?? []) {
    result.set(row.user_id, {
      user_id: row.user_id,
      display_name: row.display_name ?? 'A team member',
      email: row.email,
    });
  }

  return result;
}
