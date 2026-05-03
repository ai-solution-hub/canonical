/**
 * `handleJobFailure` — failure classifier for the `processing_queue` worker.
 * Session 222 Wave 2-B.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md`
 *   - §5.1 (lines 717-731): retry budget + transient-vs-permanent classification.
 *   - §5.2 (lines 732-748): linear-with-jitter backoff policy
 *     (`(attempts × 30s) + random(0..5000ms)`), D-7 ratified.
 *   - §5.4 (lines 771-787): dead-letter when transient + attempts ≥ max_attempts,
 *     D-2 ratified (DB CHECK widened in W1-A migration).
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W2, §2 Wave 2.
 *
 * Worker contract:
 *   The worker (`app/api/cron/process-queue/route.ts`, W2-A) calls
 *   `await handleJobFailure(supabase, job, err)` from inside the catch arm
 *   of the per-job try/catch. The helper classifies the error, decides
 *   retry-vs-dead-letter, performs the appropriate UPDATE, and returns a
 *   discriminated outcome the worker can use for telemetry.
 *
 * Classification:
 *   - **Permanent** errors throw a `PermanentJobError` (W2-A `lib/queue/dispatch.ts`)
 *     for validation/auth/quality-gate refusals. Recognised structurally via
 *     `isPermanentError(e)` (`{ permanent: true }` duck-type) so this file
 *     compiles independently of W2-A's merge order.
 *   - **Transient** errors are everything else (Anthropic 429/503, supabase 503,
 *     embedding timeout, Firecrawl 5xx, generic `Error`) — retry until
 *     `attempts ≥ max_attempts`, then dead-letter.
 *
 * Backoff (spec §5.2):
 *   Linear-with-jitter — `(attempts × 30s) + random(0..5000ms)`. We write
 *   `updated_at = NOW() + INTERVAL '<backoff>'` on the requeue UPDATE so
 *   that the W3 `claim_next_job` rewrite (out of W2 scope) can gate on
 *   `AND updated_at <= NOW()`. The current `claim_next_job` ignores
 *   `updated_at` and will re-claim immediately, which is acceptable for
 *   short backoffs per spec §5.2 ("the worker can sleep for the backoff
 *   interval inline before re-claiming, but this consumes invocation
 *   budget — only viable for backoffs ≤ 5s"). We do NOT sleep inline.
 *
 * Silent-failure compliance:
 *   Every supabase write checks `error` and throws on failure (lib helper
 *   contract — the worker's outer catch arm captures and reports).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/**
 * Outcome of a failure-handling decision. The worker uses this to drive
 * telemetry (Sentry severity + PostHog event name) per spec §6.1 / §6.2.
 */
export type FailureOutcome = 'retried' | 'failed' | 'dead_lettered';

/**
 * Minimal claimed-job shape needed by the failure classifier. The worker
 * passes the row returned by `claim_next_job` (or its dispatch wrapper).
 */
export interface ClaimedJobForFailure {
  id: string;
  job_type: string;
  attempts: number;
  max_attempts: number;
}

/**
 * Structural permanent-error check. The W2-A `PermanentJobError` class
 * (defined in `lib/queue/dispatch.ts`) sets `this.permanent = true` so
 * we can identify it without an `instanceof` import — keeping this file
 * compile-correct regardless of W2-A's merge order. After cherry-pick
 * merge, V_W2 will confirm the contract still holds.
 */
function isPermanentError(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as Record<string, unknown>).permanent === true
  );
}

/**
 * Linear-with-jitter backoff per spec §5.2 D-7.
 * Formula: `(attempts × 30s) + random(0..5000ms)`.
 * `attempts` here is the new (post-increment) attempt count.
 */
function computeBackoffSeconds(attempts: number): number {
  const linearSeconds = attempts * 30;
  const jitterMs = Math.floor(Math.random() * 5_000);
  return linearSeconds + jitterMs / 1_000;
}

/**
 * Classify a job failure and persist the appropriate state transition.
 *
 * @param supabase - Authenticated Supabase client (worker's privileged context).
 * @param job - The claimed job row (id + job_type + attempts + max_attempts).
 * @param err - The thrown error from the job-type handler.
 * @returns The outcome — `'retried' | 'failed' | 'dead_lettered'`.
 */
function extractReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

export async function handleJobFailure(
  supabase: SupabaseClient<Database>,
  job: ClaimedJobForFailure,
  err: unknown,
): Promise<FailureOutcome> {
  const reason = extractReason(err);
  const permanent = isPermanentError(err);
  const newAttempts = job.attempts + 1;
  const nowIso = new Date(Date.now()).toISOString();

  // Permanent failure (spec §5.1) — no retry.
  if (permanent) {
    const { error } = await supabase
      .from('processing_queue')
      .update({
        status: 'failed',
        error_message: reason,
        completed_at: nowIso,
        attempts: newAttempts,
      })
      .eq('id', job.id);
    if (error) throw error;
    return 'failed';
  }

  // Transient failure with retries remaining (spec §5.1 + §5.2).
  if (newAttempts < job.max_attempts) {
    const backoffSeconds = computeBackoffSeconds(newAttempts);
    const reclaimAt = new Date(
      Date.now() + backoffSeconds * 1_000,
    ).toISOString();
    const { error } = await supabase
      .from('processing_queue')
      .update({
        status: 'pending',
        error_message: null,
        attempts: newAttempts,
        // updated_at gates the W3 claim_next_job rewrite per spec §5.2.
        // Today's claim_next_job ignores updated_at; W3 adds the
        // `AND updated_at <= NOW()` clause and the future-dated value
        // here automatically becomes load-bearing.
        updated_at: reclaimAt,
      })
      .eq('id', job.id);
    if (error) throw error;
    return 'retried';
  }

  // Transient failure with no retries left → dead-letter (spec §5.4 D-2).
  const { error } = await supabase
    .from('processing_queue')
    .update({
      status: 'dead_lettered',
      error_message: reason,
      completed_at: nowIso,
      attempts: newAttempts,
    })
    .eq('id', job.id);
  if (error) throw error;
  return 'dead_lettered';
}
