/**
 * `reapStuckJobs` — visibility-timeout reaper for orphaned `processing_queue`
 * rows. Session 223 W3 wiring (was Session 222 W2-B with the supabase-js
 * UPDATE fallback; now flipped to the `reap_stuck_jobs` RPC shipped in
 * migration `20260505153750_s223_w3_claim_next_job_backoff_window.sql`).
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §5.3
 *   (lines 750-769) — orphaned-job recovery via the visibility-timeout
 *   pattern, D-8 ratified at 5-minute default.
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W2 + W3.
 *
 * Worker contract:
 *   The cron worker (`app/api/cron/process-queue/route.ts`) calls
 *   `await reapStuckJobs(supabase)` at the top of every tick BEFORE
 *   claiming new work (spec §4.3 + §5.3). A worker that crashes mid-job
 *   (Vercel Lambda OOM, network partition, deploy restart) leaves the
 *   row at `status='processing'` forever unless rescued; this helper is
 *   the rescue path.
 *
 * Spec §5.3 SQL — now ships verbatim via `reap_stuck_jobs(p_timeout_seconds)`:
 *
 *   UPDATE processing_queue
 *   SET status = 'pending', attempts = attempts + 1
 *   WHERE status = 'processing'
 *     AND started_at < NOW() - make_interval(secs => p_timeout_seconds)
 *   RETURNING ... -- count returned to the caller
 *
 * The W2 fallback (supabase-js `.update()` chain without `attempts++` —
 * supabase-js cannot express raw column expressions) is replaced by the
 * RPC, which performs the increment atomically. AC-5 of spec §8 now
 * passes the `attempts === 1` post-reap assertion.
 *
 * Returns the number of rows reaped, for the worker summary + Sentry
 * `Reaped stuck queue job` warning emit (spec §6.1.3).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/**
 * Default visibility timeout per spec §5.3 D-8 — 5 minutes.
 * Long enough to cover the 40s worker budget + Lambda cold-start +
 * finalisation, with safety margin.
 */
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 5 * 60;

/**
 * Reap rows stuck in `status='processing'` whose `started_at` is older
 * than the visibility-timeout window — flip them back to `'pending'`
 * so the next claim picks them up.
 *
 * @param supabase - Authenticated Supabase client (worker's privileged context).
 * @param opts.visibilityTimeoutSeconds - Override the 5-minute default
 *   (test hook + admin tuning). Sub-1-minute risks falsely-pending a
 *   still-running job; >15-minute delays orphaned-job recovery on a
 *   deploy outage (spec §5.3 D-8 commentary).
 * @returns Number of rows reaped (zero or more).
 */
export async function reapStuckJobs(
  supabase: SupabaseClient<Database>,
  opts: { visibilityTimeoutSeconds?: number } = {},
): Promise<number> {
  const timeoutSeconds =
    opts.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS;

  const { data, error } = await supabase.rpc('reap_stuck_jobs', {
    p_timeout_seconds: timeoutSeconds,
  });

  if (error) throw error;
  return data ?? 0;
}
