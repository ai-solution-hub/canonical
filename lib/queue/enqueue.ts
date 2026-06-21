/**
 * `enqueueQueueJob` — chokepoint helper for inserting a `processing_queue`
 * row from any producer (route handler, cron, CLI). Session 221 Wave 1-C.
 *
 * Spec: `docs/specs/background-queue-infra-spec.md` §3.4 (producer
 * responsibilities, lines 415-433) + §5.5 (idempotency contract, lines
 * 789-857). Plan: `docs/plans/background-queue-infra-plan.md` §1 W1, §2 W1-C.
 *
 * Why a chokepoint:
 *   - Centralised enforcement of the envelope contract (see
 *     `lib/queue/envelope.ts`). Every producer goes through the same
 *     `QueueJobPayload<TBody>` shape.
 *   - Idempotency dedup is implemented ONCE here so that producers cannot
 *     forget to dedup and accidentally enqueue duplicate jobs.
 *   - All Supabase writes use `sb()` (fail-fast) and all reads use
 *     `tryQuery()` (Result-returning) per the silent-failure-prevention spec
 *     (`docs/specs/silent-failure-prevention-spec.md`). ESLint rule
 *     `local/no-unchecked-supabase-error` enforces these wrappers.
 *
 * Idempotency dedup pattern (per spec §5.5):
 *   1. SELECT existing row in `('pending', 'processing', 'completed')` by
 *      `idempotency_key` — this matches the partial UNIQUE index landed by
 *      the W1-A migration, so the dedup query can use it.
 *   2. If a row is found, return its id with `deduplicated: true` and DO NOT
 *      insert. The producer treats this exactly like a successful enqueue.
 *   3. If no row, INSERT and return the new id with `deduplicated: false`.
 *
 * Race-window note: the partial UNIQUE index is the authoritative dedup
 * primitive. The dedup SELECT is a best-effort pre-check (it allows the
 * helper to return the existing id rather than failing on the UNIQUE
 * violation). If two concurrent enqueues both miss the SELECT and both try
 * to INSERT, one will succeed and the other will receive a unique-violation
 * error from `sb()` — that is the intended behaviour and the caller is
 * expected to retry the dedup-then-enqueue cycle if it wants the existing
 * id back.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type JobStatus,
  type JobType,
  type QueueJobPayload,
} from '@/lib/queue/envelope';
import { sb, tryQuery } from '@/lib/supabase/safe';
import type { Database, Json } from '@/supabase/types/database.types';

/**
 * Arguments for `enqueueQueueJob`.
 *
 * @template TBody The job-type-specific body shape. Each candidate spec
 *   (5.4.1 / 5.4.2 / 5.4.4) defines its own `TBody` interface; this helper
 *   is body-agnostic.
 */
export interface EnqueueQueueJobArgs<TBody extends Record<string, unknown>> {
  /** Supabase client the producer already has (typically from
   *  `getAuthorisedClient()`). RLS applies — the producer must have
   *  editor+ role per `processing_queue_insert_editor_admin` policy. */
  supabase: SupabaseClient<Database>;
  /** The job-type. Must be in the `JobType` union (verified by the DB
   *  CHECK constraint at INSERT time). */
  jobType: JobType;
  /** Job-type-specific body — opaque to the queue infrastructure. */
  body: TBody;
  /** Auth context to embed in the envelope. Re-validated by the worker
   *  per spec §4.2. The worker uses `auth_context.user_id` to populate
   *  `created_by` for audit trail purposes. */
  authContext: QueueJobPayload<TBody>['auth_context'];
  /** Optional idempotency key (per spec §5.5). When set, the helper
   *  performs the dedup pre-INSERT SELECT against `('pending',
   *  'processing', 'completed')` and returns the existing job_id if a
   *  row matches. The producer formula MUST include a date/version
   *  bucket — see `buildIdempotencyKey()` in `lib/queue/envelope.ts`. */
  idempotencyKey?: string;
  /** Optional `pipeline_runs.id` UUID. When set, the worker writes
   *  terminal status to that pre-existing row instead of creating a new
   *  one (per spec §6.3 Pattern 2). */
  pipelineRunId?: string;
  /** Optional priority override (default 0). Higher values are claimed
   *  first by `claim_next_job` (which orders by `priority DESC`). */
  priority?: number;
  /** Optional retry budget override (default 3). Matches the
   *  `processing_queue.max_attempts` column default. */
  maxAttempts?: number;
}

/**
 * Result returned by `enqueueQueueJob`.
 *
 * `deduplicated: true` indicates the dedup SELECT found an existing row
 * and `jobId` is that pre-existing row's id (no new INSERT). The producer
 * can use this to skip any side-effects that should run only on a fresh
 * enqueue (e.g. analytics events).
 */
export interface EnqueueQueueJobResult {
  /** UUID of the `processing_queue` row (either freshly inserted or the
   *  existing dedup-matched row). */
  jobId: string;
  /** True if the result is the existing row from a dedup hit; false if
   *  this call inserted a new row. */
  deduplicated: boolean;
}

/**
 * Insert a `processing_queue` row, with optional idempotency dedup.
 *
 * @example
 *   // Enqueue without idempotency:
 *   const { jobId } = await enqueueQueueJob({
 *     supabase,
 *     jobType: 'embed',
 *     body: { itemId: 'abc' },
 *     authContext: { user_id, role },
 *   });
 *
 * @example
 *   // Enqueue with idempotency (date-bucketed key):
 *   const idempotencyKey = buildIdempotencyKey({
 *     jobType: 'classify',
 *     scopedId: itemId,
 *     requestHash: hash(options),
 *   });
 *   const { jobId, deduplicated } = await enqueueQueueJob({
 *     supabase,
 *     jobType: 'classify',
 *     body: { itemId, options },
 *     authContext: { user_id, role },
 *     idempotencyKey,
 *   });
 *   if (deduplicated) {
 *     // Same-day retry — UI can poll the existing job_id.
 *   }
 */
export async function enqueueQueueJob<TBody extends Record<string, unknown>>(
  args: EnqueueQueueJobArgs<TBody>,
): Promise<EnqueueQueueJobResult> {
  // ---------------------------------------------------------------------
  // 1. Idempotency dedup pre-INSERT.
  //
  // Skipped when no key is supplied. Uses `tryQuery` (not `sb`) because
  // a SELECT failure should NOT cancel the enqueue: the partial UNIQUE
  // index catches any actual duplicate at INSERT time, so falling through
  // to INSERT is the correct behaviour. We only short-circuit on a
  // confirmed dedup HIT.
  // ---------------------------------------------------------------------
  if (args.idempotencyKey) {
    const dedupResult = await tryQuery(
      args.supabase
        .from('processing_queue')
        .select('id, status')
        .eq('idempotency_key', args.idempotencyKey)
        .in('status', ['pending', 'processing', 'completed'])
        .maybeSingle(),
      'queue.enqueue.dedup',
    );

    if (dedupResult.ok && dedupResult.data) {
      // Dedup HIT — return the existing row's id.
      return {
        jobId: dedupResult.data.id,
        deduplicated: true,
      };
    }
    // Dedup MISS or dedup ERROR — fall through to INSERT. The partial
    // UNIQUE index is the authoritative dedup primitive; the SELECT is
    // best-effort. On error, we proceed and accept that the worst case
    // is a unique-violation surfaced by `sb()` below (which the caller
    // can retry).
  }

  // ---------------------------------------------------------------------
  // 2. Construct the envelope per spec §3.1 (verbatim
  // `QueueJobPayload<TBody>` shape from `lib/queue/envelope.ts`).
  //
  // Conditional spread keeps the JSON small — undefined fields stay out
  // of the persisted envelope so `queueJobPayloadSchema.safeParse()`
  // doesn't see explicit `undefined` keys.
  // ---------------------------------------------------------------------
  const payload: QueueJobPayload<TBody> = {
    envelope_version: 1,
    auth_context: args.authContext,
    body: args.body,
    ...(args.idempotencyKey ? { idempotency_key: args.idempotencyKey } : {}),
    ...(args.pipelineRunId ? { pipeline_run_id: args.pipelineRunId } : {}),
  };

  // ---------------------------------------------------------------------
  // 3. INSERT with `sb()` fail-fast.
  //
  // `created_by` is set to the enqueueing user's UUID for audit-trail
  // purposes (matches the existing `processing_queue.created_by` column
  // contract). RLS policy `processing_queue_insert_editor_admin`
  // requires `get_user_role() IN ('editor', 'admin')` — failures surface
  // as `permission denied for table processing_queue`.
  // ---------------------------------------------------------------------
  // The Supabase type for `processing_queue.payload` is `Json` (a generic
  // JSON-tree shape). `QueueJobPayload<TBody>` is a stricter typed envelope
  // that doesn't carry the `[k: string]: Json | undefined` index signature
  // `Json` requires. The cast is safe — `queueJobPayloadSchema.parse()`
  // round-trips the same shape — and matches the existing codebase pattern
  // (see `lib/pipeline/start-run.ts:107`, `lib/queue/handlers/batch-reclassify.ts:948`).
  const insertPayload = {
    job_type: args.jobType,
    status: 'pending' as JobStatus,
    payload: payload as unknown as Json,
    priority: args.priority ?? 0,
    max_attempts: args.maxAttempts ?? 3,
    idempotency_key: args.idempotencyKey ?? null,
    created_by: args.authContext.user_id,
  };

  const inserted = await sb(
    args.supabase
      .from('processing_queue')
      .insert(insertPayload)
      .select('id')
      .single(),
    'queue.enqueue.insert',
  );

  return {
    jobId: inserted.id,
    deduplicated: false,
  };
}
