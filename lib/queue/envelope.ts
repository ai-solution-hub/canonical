import { z } from 'zod';

/**
 * Background queue envelope contract — Session 221 Wave 1-B.
 *
 * Spec source: `docs/specs/background-queue-infra-spec.md` §3.1 (envelope),
 * §3.3 (lifecycle states), §5.5 (idempotency formula contract).
 * Plan source: `docs/plans/background-queue-infra-plan.md` §1 W1, §2 W1-B.
 *
 * Liam OQ-3 RATIFIED S221 W3: NO speculative widen of `JobType`. Each
 * §5.4.x candidate (5.4.1 / 5.4.2) adds its own `JobType` value
 * when its candidate spec dispatches. (`'form_draft_all'` — formerly
 * `'bid_draft_all'`, renamed under ID-71 — added by
 * §5.4.1 W4-IMPL S224; `'batch_reclassify'` added by §5.4.2 W1-IMPL
 * S225 — see migrations
 * `20260505164817_s224_widen_job_type_check_bid_draft_all.sql` and
 * `20260505211806_s225_widen_job_type_check_batch_reclassify.sql`.)
 *
 * The retired §5.4.4 upload-markdown-batch job type (added S226) was
 * removed from this union by ID-46.11 once the folder-drop replacement UX
 * (ID-56.12) superseded the manual markdown-upload flow. The DB
 * `processing_queue_job_type_check` constraint deliberately RETAINS that
 * legacy value (the optional CHECK-narrowing migration is DEFERRED to
 * avoid migration churn pre-cutover); the union being a strict subset of
 * the CHECK is harmless.
 *
 * `'analyse_form'` added by ID-145 {145.13} (BI-20) — the analyse_form
 * worker lane. The producer ({145.9}'s `POST /api/procurement/upload`,
 * `app/api/procurement/upload/route.ts`) bridged this member with a
 * documented `as JobType` cast ahead of this union widening; that cast is
 * now literally true and left in place (harmless, self-documenting). The
 * DB CHECK constraint already carries the value ({145.6} W1c migration
 * `20260712062000_id145_w1c_rename_reshape.sql` STEP 7) — this commit is
 * the paired TS-union widening half of `feedback_db_check_ts_union_paired_
 * widening`.
 */

/**
 * Job-type values currently enqueued against `processing_queue`.
 *
 * The 9 values below are the actively-enqueued job types (the historic
 * types `embed | classify | extract_qa | summarise | validate | reprocess`
 * plus the pre-existing template type `template_fill`, plus `form_draft_all`
 * (formerly `bid_draft_all`, renamed under ID-71) added by §5.4.1 — see
 * `supabase/migrations/20260505164817_s224_widen_job_type_check_bid_draft_all.sql`,
 * plus `batch_reclassify` added by §5.4.2 W1-IMPL — see
 * `supabase/migrations/20260505211806_s225_widen_job_type_check_batch_reclassify.sql`).
 * (The legacy upload-markdown-batch job type was retired from the union by
 * ID-46.11 — that path is superseded by ID-56.12 folder-drop ingest.)
 *
 * The legacy synchronous template-analyse job type was retired from this
 * union by ID-52 (the app-side analyse path is superseded by the
 * pipeline-owned Path-B extractor; no producer enqueues it any more). The DB
 * `processing_queue_job_type_check` constraint deliberately RETAINS the
 * retired value — narrowing a CHECK is not run here because it would require
 * proving no extant rows hold the value, and the union being a strict subset
 * of the CHECK is harmless (the reverse mismatch is what breaks). The union is
 * the producer-side allowlist.
 *
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
  | 'form_draft_all'
  | 'batch_reclassify'
  | 'analyse_form';

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
 * - `form_draft_all:${procurementId}:${YYYY-MM-DD}:${requestHash}` ✓
 * - `batch_reclassify:${workspaceId}:${YYYY-MM-DD}:${optionsHash}` ✓
 *
 * @param args.jobType - The job-type value (must be in `JobType` union).
 * @param args.scopedId - The scoping identifier (form_id, workspace_id,
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
