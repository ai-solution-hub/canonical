/**
 * Per-job-type handler dispatch — Session 222 Wave 2-A.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §4.3 (worker
 * reference shape, lines 632-681) + §5.1 (permanent vs transient
 * classification). Plan source:
 * `docs/plans/background-queue-infra-plan.md` §1 W2, §2 W2-A.
 *
 * The W2 dispatch shell is intentionally EMPTY — the switch has no
 * `case` clauses, only the permanent-failure default. Each §5.4.x
 * candidate spec (5.4.1 / 5.4.2 / 5.4.4) adds its own `case`
 * dispatching to its own handler in its own migration commit.
 *
 * Until any candidate ships, every claimed job will fall through to the
 * `default` branch and be permanent-failed (no retry) by the worker's
 * failure classifier (`lib/queue/failure.ts`, W2-B). This is the
 * correct behaviour: an unrecognised `job_type` value should not loop
 * indefinitely on transient-retry semantics.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { JobType } from '@/lib/queue/envelope';
import type { Database } from '@/supabase/types/database.types';

/**
 * Permanent-failure marker. The worker's failure classifier (W2-B
 * `lib/queue/failure.ts`) treats throws of this class as permanent —
 * no retry, status='failed' immediately. Per spec §5.1.
 */
export class PermanentJobError extends Error {
  readonly permanent = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Per-job-type handler dispatch. Each §5.4.x candidate spec adds its own
 * `case` clause; the W2 shell is intentionally empty so that an unknown
 * `job_type` falls through to the permanent-failure default.
 *
 * The `job` parameter comes from `claim_next_job()` (`SETOF
 * processing_queue`); the worker normalises `payload` into the envelope
 * shape from `@/lib/queue/envelope`.
 */
export async function runJobByType(
  job: {
    id: string;
    job_type: string;
    payload: unknown;
    attempts: number;
    max_attempts: number;
  },
  _supabase: SupabaseClient<Database>,
): Promise<Record<string, unknown>> {
  switch (job.job_type as JobType) {
    // §5.4.1 / §5.4.2 / §5.4.4 candidate specs add cases here.
    default:
      throw new PermanentJobError(`no_handler_registered: ${job.job_type}`);
  }
}
