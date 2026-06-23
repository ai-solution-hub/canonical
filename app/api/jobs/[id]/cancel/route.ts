import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { canCooperativelyCancel } from '@/lib/queue/cooperative-cancel';
import type { JobType } from '@/lib/queue/envelope';
import { createServiceClient } from '@/lib/supabase/server';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { parseBody } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

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

export const PATCH = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
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
        .select('id, status, job_type, payload')
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

      // ID-76 pending-cancel orphan fix: a *pending* job's worker never runs,
      // so its pre-allocated pipeline_runs row (if any) would stay 'running'/
      // 'in_progress' forever and the upload-tab poller would spin. Close it to
      // 'cancelled' here. Cooperative cancel of a *processing* job is finalised
      // by the worker (finaliseRun / dispatch), so we restrict to 'pending' to
      // avoid a double-write race. pipeline_run_id lives on the queue envelope,
      // so this covers any producer that pre-allocates a pipeline_runs row
      // (batch_reclassify, form_draft_all). Service-role client: pipeline_runs has
      // admin-only INSERT/SELECT but NO UPDATE policy, so the auth-scoped
      // client's UPDATE is silently RLS-denied. Do NOT use recordPipelineRun
      // (INSERT-only → would create a 2nd row).
      if (existing.status === 'pending') {
        const payload = existing.payload as {
          pipeline_run_id?: unknown;
        } | null;
        const pipelineRunId =
          payload &&
          typeof payload === 'object' &&
          typeof payload.pipeline_run_id === 'string'
            ? payload.pipeline_run_id
            : null;
        if (pipelineRunId) {
          const serviceClient = createServiceClient();
          const { error: runErr } = await serviceClient
            .from('pipeline_runs')
            .update({
              status: 'cancelled',
              completed_at: new Date().toISOString(),
              error_message: 'cancelled before processing started',
            })
            .eq('id', pipelineRunId);
          if (runErr) {
            // Best-effort: the queue row is already cancelled; a failed
            // pipeline_runs close-out must not fail the user's cancel.
            logBestEffortWarn(
              'jobs.cancel.pipeline_runs.update_failed',
              `Failed to close pipeline_runs row ${pipelineRunId} on pending cancel`,
              { pipelineRunId, dbError: runErr.message },
            );
          }
        }
      }

      return NextResponse.json({ jobId, status: 'cancelled' }, { status: 200 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to cancel job') },
        { status: 500 },
      );
    }
  },
);
