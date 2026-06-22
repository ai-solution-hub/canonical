import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { CLIENT_CONFIG } from '@/lib/client-config';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { enqueueQueueJob } from '@/lib/queue/enqueue';
import { buildIdempotencyKey } from '@/lib/queue/envelope';
import type { BatchReclassifyBody } from '@/lib/queue/handlers/batch-reclassify';
import { sb } from '@/lib/supabase/safe';
import { createServiceClient } from '@/lib/supabase/server';
import { parseBody } from '@/lib/validation';

/**
 * POST /api/admin/batch-reclassify — queue a `batch_reclassify` job.
 *
 * Spec: `docs/specs/§5.4.2-batch-reclassify-spec.md` §7.5 + ratified D-x
 * decisions (May 5 2026):
 *   - D-1 ratified to `editor` (flipped from authored `admin`) for §5.4.1
 *     symmetry — admins satisfy via `ROLE_RANK`.
 *   - D-4 ratified CLI-only with future UI: this route ships (the queued
 *     endpoint must exist for future UI to call), but the admin UI page
 *     `/admin/reclassify` is dropped from the candidate scope.
 *   - D-6 SHA-256 hex truncated 16 char (same as §5.4.1 D-7).
 *   - D-8 body-only encoding (envelope `auth_context.workspace_id` omitted
 *     because Knowledge Hub `client_id` is non-UUID `'default'`).
 *
 * Pattern: HTTP 202 + `{ job_id, pipeline_run_id, status: 'queued',
 * deduplicated }` (mirrors `app/api/bids/[id]/responses/draft-all/route.ts`
 * + spec §3.4 step 3).
 *
 * pipeline_runs Pattern 2 (spec §6.3): the producer pre-allocates the
 * `pipeline_runs.id` UUID and INSERTs the `running` row at-enqueue, so
 * future UI polling can display progress from t=0. The worker UPDATEs
 * the SAME row at-terminal — see `lib/queue/dispatch.ts`
 * `case 'batch_reclassify':` for the dispatch-level finalisation.
 */
export const maxDuration = 30;

/**
 * Body schema for POST /api/admin/batch-reclassify.
 *
 * Mirrors `BatchReclassifyBody` interface (`lib/queue/handlers/batch-reclassify.ts`)
 * with all fields except `workspace_id` having defaults; `workspace_id`
 * defaults to `CLIENT_CONFIG.client_id`.
 *
 * Per `feedback_validation_sweep_safeparse_ban`: this schema is consumed
 * via `parseBody(BatchReclassifyBodyZodSchema, raw)` from `@/lib/validation`,
 * never inline (validation-sweep guard banned).
 */
const BatchReclassifyBodyZodSchema = z.object({
  workspace_id: z
    .string()
    .min(1)
    .default(() => CLIENT_CONFIG.client_id),
  domain: z.string().nullable().optional(),
  limit: z.number().int().min(0).default(0),
  force: z.boolean().default(false),
  entities_only: z.boolean().default(false),
  batch_size: z.number().int().min(1).max(3).default(1),
  model_tier: z.string().default('claude-sonnet-4-6'),
});

/**
 * Compute SHA-256 hex of canonical-JSON-stringified body, truncated to 16
 * chars. Per spec D-6 + §5.4.1 D-7 (verbatim algorithm — alphabetical key
 * order so JSON serialisation is deterministic).
 */
async function computeOptionsHash(body: BatchReclassifyBody): Promise<string> {
  // Alphabetical key order — matches §5.4.1 producer route pattern.
  const canonical = JSON.stringify({
    batch_size: body.batch_size,
    domain: body.domain ?? null,
    entities_only: body.entities_only,
    force: body.force,
    limit: body.limit,
    model_tier: body.model_tier,
    workspace_id: body.workspace_id,
  });
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

const BatchReclassifyResponseSchema = z.object({
  job_id: z.string(),
  pipeline_run_id: z.string(),
  status: z.literal('queued'),
  deduplicated: z.boolean(),
});

export const POST = defineRoute(
  BatchReclassifyResponseSchema,
  async (request: NextRequest) => {
    try {
      // ----------------------------------------------------------------
      // Auth: per D-1 ratified — `'admin'` and `'editor'` both authorised.
      // The dispatcher's `reValidateAuthContext` uses `requiredRole: 'editor'`
      // so admins satisfy via `ROLE_RANK`.
      // ----------------------------------------------------------------
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, role, supabase } = auth;

      // ----------------------------------------------------------------
      // Body parse via parseBody (per feedback_validation_sweep_safeparse_ban).
      // ----------------------------------------------------------------
      let raw: unknown = {};
      try {
        raw = await request.json();
      } catch {
        // Empty body or malformed JSON — both treated as empty payload so
        // schema defaults apply.
        raw = {};
      }
      const parsed = parseBody(BatchReclassifyBodyZodSchema, raw);
      if (!parsed.success) return parsed.response;

      const body: BatchReclassifyBody = {
        workspace_id: parsed.data.workspace_id,
        domain: parsed.data.domain ?? null,
        limit: parsed.data.limit,
        force: parsed.data.force,
        entities_only: parsed.data.entities_only,
        batch_size: parsed.data.batch_size,
        model_tier: parsed.data.model_tier,
      };

      // ----------------------------------------------------------------
      // Idempotency key per spec §3.2 + D-6 (SHA-256 hex truncated 16
      // chars of canonical-key-order JSON of options).
      // ----------------------------------------------------------------
      const optionsHash = await computeOptionsHash(body);
      const idempotencyKey = buildIdempotencyKey({
        jobType: 'batch_reclassify',
        scopedId: body.workspace_id,
        requestHash: optionsHash,
      });

      // ----------------------------------------------------------------
      // pipeline_runs Pattern 2: caller-allocated UUID + INSERT
      // `status='running'` at-enqueue. The worker UPDATEs the SAME row
      // at-terminal (see `lib/queue/dispatch.ts` `case 'batch_reclassify':`).
      //
      // Service-role client: `pipeline_runs_insert` RLS is admin-only
      // (per migrations/20260416102457_pre_squash_reconciliation.sql:6178);
      // editor producers would be silently denied. Same pattern as
      // §5.4.1 W4-IMPL.
      //
      // workspaceId is NULL because `body.workspace_id` is the non-UUID
      // CLIENT_CONFIG.client_id ('default'); pipeline_runs.workspace_id
      // is FK to `workspaces(id)` so a non-UUID would FK-fail. This is
      // the §3.4 D-8 body-only-encoding consequence: workspace scope
      // lives in body, not in the foreign-key column.
      // ----------------------------------------------------------------
      const pipelineRunId = crypto.randomUUID();
      const serviceClient = createServiceClient();
      await sb(
        serviceClient.from('pipeline_runs').insert({
          id: pipelineRunId,
          pipeline_name: 'batch_reclassify',
          status: 'running',
          workspace_id: null,
        }),
        'admin.batchReclassify.pipelineRunInsert',
      );

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
      //
      // Per D-8 body-only encoding: `auth_context.workspace_id` is OMITTED
      // (envelope's UUID constraint would reject the non-UUID
      // CLIENT_CONFIG.client_id). Workspace scope lives in
      // `body.workspace_id` instead — the handler validates
      // `body.workspace_id === CLIENT_CONFIG.client_id` per spec §4.3.
      // ----------------------------------------------------------------
      void supabase; // Auth-scoped client retained for symmetry; service-role used for write paths.
      const enqueueResult = await enqueueQueueJob<BatchReclassifyBody>({
        supabase: serviceClient,
        jobType: 'batch_reclassify',
        body,
        authContext: { user_id: user.id, role },
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
      logger.error({ err }, 'admin.batchReclassify: enqueue failed');
      return NextResponse.json(
        {
          error: safeErrorMessage(err, 'Failed to queue batch_reclassify job'),
        },
        { status: 500 },
      );
    }
  },
);
