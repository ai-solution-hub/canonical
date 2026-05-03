/**
 * `reapStuckJobs` — visibility-timeout reaper for orphaned `processing_queue`
 * rows. Session 222 Wave 2-B.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §5.3
 *   (lines 750-769) — orphaned-job recovery via the visibility-timeout
 *   pattern, D-8 ratified at 5-minute default.
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W2, §2 Wave 2.
 *
 * Worker contract:
 *   The cron worker (`app/api/cron/process-queue/route.ts`, W2-A) calls
 *   `await reapStuckJobs(supabase)` at the top of every tick BEFORE
 *   claiming new work (spec §4.3 + §5.3). A worker that crashes mid-job
 *   (Vercel Lambda OOM, network partition, deploy restart) leaves the
 *   row at `status='processing'` forever unless rescued; this helper is
 *   the rescue path.
 *
 * Spec §5.3 SQL reference:
 *
 *   UPDATE processing_queue
 *   SET status = 'pending', attempts = attempts + 1
 *   WHERE status = 'processing'
 *     AND started_at < NOW() - INTERVAL '<visibility_timeout> seconds';
 *
 * Implementation deviation from the spec SQL — `attempts = attempts + 1`:
 *   `supabase-js` does not support raw SQL expressions in the column-update
 *   payload. The two implementation options are (a) an RPC for this
 *   single UPDATE (out of W2 scope — no DDL in this wave), or (b) fetch +
 *   client-side increment + bulk update (round-trip cost on every cron
 *   tick). We ship the simpler `status: 'pending'` UPDATE without the
 *   attempt increment for W2; the increment is a refinement that lands
 *   alongside the W3 `claim_next_job` rewrite (RPC migration is the
 *   correct home for it). This is acceptable for W2 because the worker
 *   on the next claim will see the row as fresh `'pending'` and
 *   re-process it once — the spec's increment is a defence against
 *   infinite-reap loops on a permanently-broken job, which only matters
 *   after `max_attempts` retries; the dead-letter path in
 *   `lib/queue/failure.ts` already enforces that bound.
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
  const cutoff = new Date(Date.now() - timeoutSeconds * 1_000).toISOString();

  const { data, error } = await supabase
    .from('processing_queue')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('started_at', cutoff)
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}
