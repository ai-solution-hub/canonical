import { z } from 'zod';

/**
 * Background queue envelope contract — Session 221 Wave 1-B.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §3.1 (envelope),
 * §3.3 (lifecycle states), §5.5 (idempotency formula contract).
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W1, §2 W1-B.
 *
 * Liam OQ-3 RATIFIED S221 W3: NO speculative widen of `JobType`. Each
 * §5.4.x candidate (5.4.1 / 5.4.2 / 5.4.4) adds its own `JobType` value
 * when its candidate spec dispatches. (`'bid_draft_all'` added by
 * §5.4.1 W4-IMPL S224; `'batch_reclassify'` added by §5.4.2 W1-IMPL
 * S225; `'markdown_batch'` added by §5.4.4 W1-IMPL S226 — see migrations
 * `20260505164817_s224_widen_job_type_check_bid_draft_all.sql`,
 * `20260505211806_s225_widen_job_type_check_batch_reclassify.sql`, and
 * `20260506125704_s226_widen_job_type_check_markdown_batch.sql`.)
 */

/**
 * Job-type values currently accepted by `processing_queue_job_type_check`.
 *
 * The 11 values below are the current CHECK-constraint allowlist (the
 * historic types `embed | classify | extract_qa | summarise | validate |
 * reprocess` plus the two pre-existing template types `template_fill` and
 * `template_analyse`, plus `bid_draft_all` added by §5.4.1 — see
 * `supabase/migrations/20260505164817_s224_widen_job_type_check_bid_draft_all.sql`,
 * plus `batch_reclassify` added by §5.4.2 W1-IMPL — see
 * `supabase/migrations/20260505211806_s225_widen_job_type_check_batch_reclassify.sql`,
 * plus `markdown_batch` added by §5.4.4 W1-IMPL S226 — see
 * `supabase/migrations/20260506125704_s226_widen_job_type_check_markdown_batch.sql`).
 * Each future §5.4.x migration candidate adds its own value through its own
 * CHECK-widening migration paired with a TS-union widening commit (per
 * `feedback_db_check_ts_union_paired_widening`).
 */
export type JobType =
  | 'embed'
  | 'classify'
  | 'extract_qa'
  | 'summarise'
  | 'validate'
  | 'reprocess'
  | 'template_fill'
  | 'template_analyse'
  | 'bid_draft_all'
  | 'batch_reclassify'
  | 'markdown_batch';

/**
 * Lifecycle states for `processing_queue.status`.
 *
 * Per spec §3.3: existing constraint allows `pending | processing | completed
 * | failed | cancelled`. This union adds `'dead_lettered'` (D-2 widening),
 * paired with the W1-A migration that widens the DB CHECK constraint —
 * see `feedback_db_check_ts_union_paired_widening` for the discipline.
 *
 * State transitions (spec §3.3):
 *   pending ──claim──▶ processing ──success──▶ completed
 *                                  ──fail──▶ failed (or back to pending if
 *                                                    retryable + attempts < max)
 *                                  ──exhaust──▶ dead_lettered
 *   pending ──cancel──▶ cancelled
 */
export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead_lettered';

/**
 * Queue job payload envelope (verbatim contract from spec §3.1).
 * Stored in `processing_queue.payload` (JSONB column,
 * `DEFAULT '{}'::jsonb NOT NULL`).
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §3.1
 * (lines 318-356). Job-type-specific shape lives entirely inside `body`
 * so each migration candidate can evolve its own schema without touching
 * the envelope contract.
 *
 * ```
 * interface QueueJobPayload<TBody extends Record<string, unknown>> {
 *   // Schema version for the envelope. Bump when incompatible.
 *   envelope_version: 1;
 *
 *   // Auth context reconstructed by the worker. See §4.2.
 *   auth_context: {
 *     // UUID of the user who enqueued the job (for audit + role re-validation).
 *     user_id: string;
 *     // Snapshot of the user's role at enqueue time. The worker re-validates
 *     // against `user_roles` before performing any privileged operation.
 *     role: 'admin' | 'editor' | 'viewer';
 *     // Optional workspace scope, when the job operates on a single workspace.
 *     workspace_id?: string;
 *   };
 *
 *   // Optional idempotency key. See §5.5 — when set, the queue refuses
 *   // a duplicate enqueue (existing pending/processing/completed row with the
 *   // same key returns the existing job_id rather than creating a new row).
 *   // Formula contract (MANDATORY when set, per §5.5 + D-1):
 *   // `<job_type>:<scoped_id>:<YYYY-MM-DD>:<requestHash>` — the date bucket
 *   // separates explicit re-run intent from same-day producer retries.
 *   idempotency_key?: string;
 *
 *   // Optional pipeline_runs row UUID for cross-linking, when the job's
 *   // caller has already created (or pre-allocated) a pipeline_runs row.
 *   // The worker writes terminal status to the existing row instead of
 *   // creating a new one. See §6.3.
 *   pipeline_run_id?: string;
 *
 *   // Job-type-specific body — opaque to the queue infra.
 *   body: TBody;
 * }
 * ```
 */
export interface QueueJobPayload<TBody extends Record<string, unknown>> {
  /** Schema version for the envelope. Bump when incompatible. */
  envelope_version: 1;

  /** Auth context reconstructed by the worker. See spec §4.2. */
  auth_context: {
    /** UUID of the user who enqueued the job (for audit + role re-validation). */
    user_id: string;
    /** Snapshot of the user's role at enqueue time. The worker re-validates
     * against `user_roles` before performing any privileged operation. */
    role: 'admin' | 'editor' | 'viewer';
    /** Optional workspace scope, when the job operates on a single workspace. */
    workspace_id?: string;
  };

  /** Optional idempotency key. See spec §5.5 — when set, the queue refuses
   * a duplicate enqueue (existing pending/processing/completed row with the
   * same key returns the existing job_id rather than creating a new row).
   * Formula contract (MANDATORY when set, per spec §5.5 + D-1):
   * `<job_type>:<scoped_id>:<YYYY-MM-DD>:<requestHash>` — the date bucket
   * separates explicit re-run intent from same-day producer retries. */
  idempotency_key?: string;

  /** Optional pipeline_runs row UUID for cross-linking, when the job's
   * caller has already created (or pre-allocated) a pipeline_runs row.
   * The worker writes terminal status to the existing row instead of
   * creating a new one. See spec §6.3. */
  pipeline_run_id?: string;

  /** Job-type-specific body — opaque to the queue infra. */
  body: TBody;
}

/**
 * Build an idempotency_key matching the spec §5.5 formula:
 *   `<job_type>:<scoped_id>:<YYYY-MM-DD>:<requestHash>`
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §5.5 line 806;
 * D-1 contract ratified S218 W3 + reaffirmed S221 W3.
 *
 * The date bucket is MANDATORY — it separates explicit re-run intent
 * (different date → distinct key → fresh enqueue) from same-day producer
 * retries (same date → identical key → dedup hit). Per Liam D-1 ratified
 * S218 W3.
 *
 * The date is sliced to YYYY-MM-DD UTC so the bucket is deterministic
 * across timezones (otherwise a producer in BST and a producer in PDT
 * could disagree on the bucket boundary near midnight).
 *
 * Examples (spec §5.5 lines 813-815):
 * - `bid_draft_all:${procurementId}:${YYYY-MM-DD}:${requestHash}` ✓
 * - `batch_reclassify:${workspaceId}:${YYYY-MM-DD}:${optionsHash}` ✓
 * - `markdown_batch:${batchId}:${YYYY-MM-DD}:${fileSetHash}` ✓
 *
 * @param args.jobType - The job-type value (must be in `JobType` union).
 * @param args.scopedId - The scoping identifier (bid_id, workspace_id,
 *   batch_id, etc. — chosen per candidate spec).
 * @param args.requestHash - A deterministic hash of the request options
 *   (so different option sets produce different keys, but identical option
 *   sets produce the same key on the same day).
 * @param args.dateUtc - Optional Date for testability; defaults to `new Date()`.
 *   The UTC date is sliced to YYYY-MM-DD for the bucket.
 */
export function buildIdempotencyKey(args: {
  jobType: JobType;
  scopedId: string;
  requestHash: string;
  dateUtc?: Date;
}): string {
  const date = (args.dateUtc ?? new Date()).toISOString().slice(0, 10);
  return `${args.jobType}:${args.scopedId}:${date}:${args.requestHash}`;
}

/**
 * Zod schema validating the `QueueJobPayload` envelope shape.
 *
 * The worker uses this in W2 to reject malformed envelopes (e.g.
 * `envelope_version: 999` per AC-4). The `body` field is
 * `z.record(z.string(), z.unknown())` because each job-type validates its
 * own body in its handler — envelope-level validation only enforces the
 * wrapper.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §3.1 + §8 AC-4.
 */
export const queueJobPayloadSchema = z.object({
  envelope_version: z.literal(1),
  auth_context: z.object({
    user_id: z.string().uuid(),
    role: z.enum(['admin', 'editor', 'viewer']),
    workspace_id: z.string().uuid().optional(),
  }),
  idempotency_key: z.string().min(1).optional(),
  pipeline_run_id: z.string().uuid().optional(),
  body: z.record(z.string(), z.unknown()),
});
