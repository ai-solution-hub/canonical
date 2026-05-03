/**
 * Background queue worker cron — Session 222 Wave 2-A.
 *
 * Spec: `docs/specs/background-queue-infra-spec.md` §4.3 (worker reference
 * shape, lines 632-681) + §5.3 (visibility-timeout reap before claim) +
 * §10 D-9 (every-5-minute schedule). Plan:
 * `docs/plans/background-queue-infra-plan.md` §1 W2, §2 W2-A.
 *
 * Single canonical worker route (per spec §R9 mitigation): all
 * `processing_queue` job types are dispatched through `runJobByType`
 * — never a per-domain worker route. Each cron invocation:
 *
 *   1. Verifies the cron secret (rejects 401 otherwise).
 *   2. Reaps stuck `processing` jobs whose `started_at` is older than
 *      the visibility-timeout window (per §5.3).
 *   3. Claims jobs one-at-a-time via `claim_next_job()` until either
 *      the queue is empty or the per-invocation budget
 *      (`TIMEOUT_BUFFER_MS`) is approached.
 *   4. For each claim, dispatches via `runJobByType` and writes a
 *      terminal status (`completed` on success; `handleJobFailure`
 *      classifies failure into `retried | failed | dead_lettered`).
 *
 * AC-8 (service-role): the worker uses `createServiceClient()` to
 * bypass user-scoped RLS — `processing_queue` is editor+ for INSERT
 * but the cron runs without any user context.
 *
 * AC-11 (concurrency): `claim_next_job` uses
 * `FOR UPDATE SKIP LOCKED` so multiple parallel cron invocations
 * cannot double-claim a row. The worker's loop ends when the RPC
 * returns no row.
 */

import { NextRequest, NextResponse } from 'next/server';

import { verifyCronAuth } from '@/lib/cron-auth';
import { runJobByType } from '@/lib/queue/dispatch';
import { handleJobFailure } from '@/lib/queue/failure';
import { reapStuckJobs } from '@/lib/queue/visibility-timeout';
import { createServiceClient } from '@/lib/supabase/server';
import type { Json } from '@/supabase/types/database.types';

export const maxDuration = 50;

/** Stop claiming when within 10s of the Vercel function timeout
 *  (`maxDuration = 50`) so the in-flight job has time to write its
 *  terminal status + the response can flush. Per spec §4.4. */
const TIMEOUT_BUFFER_MS = 40_000;

interface InvocationSummary {
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  deadletter: number;
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = createServiceClient();

  // Visibility-timeout reap BEFORE claiming new work (spec §5.3 + §4.3
  // ordering). A worker crash leaves a row at `status='processing'`
  // forever; the reap returns those rows to `pending` so the very same
  // tick can re-claim them.
  await reapStuckJobs(supabase);

  const summary: InvocationSummary = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    deadletter: 0,
  };

  while (Date.now() - startTime < TIMEOUT_BUFFER_MS) {
    const { data: job, error } = await supabase.rpc('claim_next_job').single();
    if (error || !job) break;

    summary.processed += 1;
    try {
      const result = await runJobByType(job, supabase);
      const { error: updateError } = await supabase
        .from('processing_queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          // `result` is `Record<string, unknown>` — cast through `unknown`
          // to the column's `Json` type. Same pattern as
          // `lib/queue/enqueue.ts:205`.
          result: result as unknown as Json,
        })
        .eq('id', job.id);
      if (updateError) throw updateError;
      summary.succeeded += 1;
    } catch (err) {
      const outcome = await handleJobFailure(supabase, job, err);
      // outcome enums: 'retried' | 'failed' | 'dead_lettered'
      if (outcome === 'retried') summary.retried += 1;
      else if (outcome === 'failed') summary.failed += 1;
      else if (outcome === 'dead_lettered') summary.deadletter += 1;
    }
  }

  return NextResponse.json(summary);
}
