import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';
import { safeErrorMessage } from '@/lib/error';
import { canCooperativelyCancel } from '@/lib/queue/cooperative-cancel';
import type { JobType } from '@/lib/queue/envelope';

/**
 * PATCH /api/jobs/:id/cancel — user-initiated cancellation of a queued job.
 * Session 222 Wave 2-B; cooperative-cancel widening Session 225 W1-IMPL.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §5.6 (lines 859-878)
 * + `docs/specs/§5.4.2-batch-reclassify-spec.md` §10 D-9 (cooperative
 * cancellation between items).
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W2, §2 Wave 2.
 *
 * Behaviour:
 *   - `'pending'` jobs can always be cancelled (race-safe via the
 *     `.in('status', ['pending', 'processing'])` filter — see below).
 *   - `'processing'` jobs can be cancelled ONLY if their `job_type` opts in
 *     to cooperative cancellation via `canCooperativelyCancel(job_type)`.
 *     For non-opt-in job types, processing jobs return 409 ("this job is
 *     already running and cannot be cancelled") preserving §5.4.1
 *     hard-409 semantics.
 *   - Already-terminal jobs (completed / failed / cancelled / dead_lettered)
 *     return 409 with the current status — the user-facing UX should
 *     surface "this job has already finished".
 *   - The UPDATE is race-safe via the `.in('status', [...])` filter:
 *     if the worker transitions the row between our SELECT and our UPDATE,
 *     the UPDATE will affect zero rows. Cooperatively-cancelable handlers
 *     poll `processing_queue.status` between items and stop when they see
 *     `'cancelled'` (per `lib/queue/handlers/batch-reclassify.ts`).
 *
 * Auth:
 *   Admin or editor (a viewer cannot cancel jobs even their own — RLS on
 *   `processing_queue` is set up to allow editors / admins to read all
 *   rows; tightening to "creator-only cancel" is a future refinement).
 *
 * Validation-sweep guard compliance:
 *   The PATCH body is empty (the dynamic `[id]` param carries the job id),
 *   but we MUST import `parseBody` from `@/lib/validation` per the
 *   `feedback_validation_sweep_guard` discipline. The empty
 *   `z.object({}).strict()` schema satisfies the import requirement
 *   without changing semantics — any caller-supplied body is silently
 *   discarded (cancellation is a parameter-less PATCH).
 */

const CancelBodySchema = z.object({}).strict();

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: jobId } = await params;
    if (!UUID_RE.test(jobId)) {
      return NextResponse.json(
        { error: 'Invalid job ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Validation-sweep guard compliance: parseBody must be referenced even
    // though the cancel body is empty. We accept either an empty body or
    // a missing body — both are valid PATCH payloads for cancellation.
    let raw: unknown = {};
    try {
      raw = await request.json();
    } catch {
      // Empty body or malformed JSON — both treated as empty payload.
      raw = {};
    }
    const parsed = parseBody(CancelBodySchema, raw);
    if (!parsed.success) return parsed.response;

    // Read current status + job_type to disambiguate 404 vs 409 vs 200,
    // and to check whether `'processing'` jobs of this type opt in to
    // cooperative cancellation per §5.4.2 D-9.
    const { data: existing, error: readErr } = await supabase
      .from('processing_queue')
      .select('id, status, job_type')
      .eq('id', jobId)
      .maybeSingle();

    if (readErr) {
      return NextResponse.json(
        { error: safeErrorMessage(readErr, 'Failed to read job status') },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Decide which statuses are cancellable for this job_type:
    //   - 'pending' is always cancellable.
    //   - 'processing' is cancellable ONLY if the job_type opts in via
    //     `canCooperativelyCancel(job_type)`. Otherwise: hard-409
    //     preserving §5.4.1 semantics.
    const jobType = existing.job_type as JobType;
    const cancellableStatuses: Array<'pending' | 'processing'> = ['pending'];
    if (canCooperativelyCancel(jobType)) {
      cancellableStatuses.push('processing');
    }

    if (
      existing.status === 'processing' &&
      !cancellableStatuses.includes('processing')
    ) {
      return NextResponse.json(
        {
          error: 'This job is already running and cannot be cancelled.',
          status: existing.status,
        },
        { status: 409 },
      );
    }
    if (existing.status !== 'pending' && existing.status !== 'processing') {
      return NextResponse.json(
        {
          error: `Job is in terminal state '${existing.status}' and cannot be cancelled.`,
          status: existing.status,
        },
        { status: 409 },
      );
    }

    // Race-safe UPDATE — the `.in('status', cancellableStatuses)` guard
    // per spec §5.6 + §5.4.2 D-9 ensures we don't overwrite a row the
    // worker has just transitioned. For non-cooperative job types the
    // statuses list is `['pending']` (verbatim §5.4.1 behaviour); for
    // cooperative job types it's `['pending', 'processing']` so the
    // UPDATE flips a `'processing'` row to `'cancelled'` and the
    // handler's inter-item poll observes the new status on the next
    // tick.
    const { error: updateErr } = await supabase
      .from('processing_queue')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'cancelled by user',
      })
      .eq('id', jobId)
      .in('status', cancellableStatuses);

    if (updateErr) {
      return NextResponse.json(
        { error: safeErrorMessage(updateErr, 'Failed to cancel job') },
        { status: 500 },
      );
    }

    return NextResponse.json({ jobId, status: 'cancelled' }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to cancel job') },
      { status: 500 },
    );
  }
}
