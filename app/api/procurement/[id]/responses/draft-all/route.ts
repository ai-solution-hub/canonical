import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ResponseDraftAllBodySchema } from '@/lib/validation/schemas';
import type { ProcurementWorkflowState } from '@/lib/procurement/procurement-workflow';
import { sb } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { enqueueQueueJob } from '@/lib/queue/enqueue';
import { buildIdempotencyKey } from '@/lib/queue/envelope';
import type { ProcurementDraftAllBody } from '@/lib/queue/handlers/procurement-draft-all';

/**
 * POST /api/procurement/:id/responses/draft-all — queue a `form_draft_all` job.
 *
 * Pre-S224, this route ran a synchronous 100-question loop with a
 * `maxDuration = 120` Vercel cap and a `TIMEOUT_SAFETY_MS = 100_000` safety
 * break. Per `docs/specs/§5.4.1-batch-draft-all-spec.md` §7.5 + D-6
 * ratification, the route now ENQUEUES a `form_draft_all` job onto
 * `processing_queue` and returns HTTP 202 with `{ job_id, pipeline_run_id,
 * status: 'queued', deduplicated }`. The cron worker
 * (`app/api/cron/process-queue/route.ts`) drains the job via
 * `lib/queue/dispatch.ts` `case 'form_draft_all':` and the UI polls
 * `/api/jobs/:job_id/status` for terminal state.
 *
 * pipeline_runs Pattern 2 (spec §6.3): the producer pre-allocates the
 * `pipeline_runs.id` UUID and INSERTs the `running` row at-enqueue, so the
 * UI can display progress from t=0 (before the worker has claimed the job).
 * The worker UPDATEs the SAME row at-terminal — see
 * `lib/queue/dispatch.ts` for the dispatch-level finalisation.
 */
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const rl = checkRateLimit(`draft-all:${user.id}`, 1, 120_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    const raw = await request.json();
    const parsed = parseBody(ResponseDraftAllBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { model_tier, skip_existing } = parsed.data;

    // ----------------------------------------------------------------
    // Pre-conditions kept verbatim from the pre-S224 sync route — these
    // fail fast at HTTP-level before any queue work, surfacing 4xx
    // errors to the user immediately rather than via worker dead-letter.
    // ----------------------------------------------------------------
    // Post-T2: discriminator via application_types JOIN.
    const { data: bid, error: procurementError } = await supabase
      .from('workspaces')
      .select('id, status, domain_metadata, application_types!inner(key)')
      .eq('id', id)
      .eq('application_types.key', 'procurement')
      .single();

    if (procurementError || !bid) {
      return NextResponse.json(
        { error: 'Procurement not found' },
        { status: 404 },
      );
    }

    const procurementStatus =
      (bid.status as ProcurementWorkflowState) ?? 'draft';
    const draftableStates: ProcurementWorkflowState[] = [
      'drafting',
      'in_review',
      'ready_for_export',
    ];
    if (!draftableStates.includes(procurementStatus)) {
      return NextResponse.json(
        {
          error: `Procurement is in "${procurementStatus}" state -- must be in drafting or later to generate responses`,
          current_status: procurementStatus,
        },
        { status: 400 },
      );
    }

    // ----------------------------------------------------------------
    // Idempotency key per spec §3.2 + D-7 (SHA-256 hex truncated to
    // 16 chars of canonical-key-order JSON of options).
    // ----------------------------------------------------------------
    const optionsCanonical = JSON.stringify({ model_tier, skip_existing });
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(optionsCanonical),
    );
    const requestHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);

    const idempotencyKey = buildIdempotencyKey({
      jobType: 'form_draft_all',
      scopedId: id,
      requestHash,
    });

    // ----------------------------------------------------------------
    // pipeline_runs Pattern 2: caller-allocated UUID + INSERT
    // `status='running'` at-enqueue. The worker UPDATEs the SAME row
    // at-terminal (see `lib/queue/dispatch.ts` `case 'form_draft_all':`).
    //
    // Service-role client: `pipeline_runs_insert` RLS is admin-only;
    // editor producers would be silently denied. Same pattern as
    // `lib/mcp/tools/content.ts:374`.
    // ----------------------------------------------------------------
    const pipelineRunId = crypto.randomUUID();
    const serviceClient = createServiceClient();
    await sb(
      serviceClient.from('pipeline_runs').insert({
        id: pipelineRunId,
        pipeline_name: 'form_draft_all',
        status: 'running',
        workspace_id: id,
      }),
      'bids.response.draftAll.pipelineRunInsert',
    );

    // ----------------------------------------------------------------
    // Resolve role for envelope auth_context (worker uses this to
    // re-validate via `reValidateAuthContext` per spec §4.2). The
    // pre-condition above already passed `getAuthorisedClient(['admin',
    // 'editor'])` — fall back to 'editor' on lookup failure rather than
    // failing the enqueue (worker-side re-validation is authoritative).
    // ----------------------------------------------------------------
    const { data: roleRow, error: roleErr } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    if (roleErr) {
      logger.warn(
        { err: roleErr, userId: user.id },
        'bids.response.draftAll: user_roles lookup failed, defaulting role to editor',
      );
    }
    const role = (roleRow?.role ?? 'editor') as 'admin' | 'editor' | 'viewer';

    // ----------------------------------------------------------------
    // Enqueue. The chokepoint helper handles dedup pre-INSERT against
    // the partial UNIQUE index on `(idempotency_key) WHERE status IN
    // ('pending', 'processing', 'completed')` — same-day re-enqueue
    // returns the existing job_id with `deduplicated: true`.
    //
    // Service-role client: `processing_queue_insert_editor_admin` allows
    // editor INSERT, but `processing_queue_select_admin` is admin-only —
    // an editor's `.insert(...).select('id').single()` succeeds at the
    // INSERT step and then fails at RETURNING (PGRST116 0-rows). Using
    // the service-role client bypasses RLS for both the dedup SELECT
    // and the INSERT-with-RETURNING. `created_by` is sourced from
    // `authContext.user_id` (not `auth.uid()`), so audit trail is
    // preserved even with the elevated client.
    // ----------------------------------------------------------------
    const enqueueResult = await enqueueQueueJob<ProcurementDraftAllBody>({
      supabase: serviceClient,
      jobType: 'form_draft_all',
      body: { form_id: id, model_tier, skip_existing },
      authContext: { user_id: user.id, role, workspace_id: id },
      idempotencyKey,
      pipelineRunId,
      priority: 0,
      maxAttempts: 3,
    });

    return NextResponse.json(
      {
        job_id: enqueueResult.jobId,
        pipeline_run_id: pipelineRunId,
        status: 'queued',
        deduplicated: enqueueResult.deduplicated,
      },
      { status: 202 },
    );
  } catch (err) {
    logger.error({ err }, 'bids.response.draftAll: enqueue failed');
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to queue draft-all job') },
      { status: 500 },
    );
  }
}
