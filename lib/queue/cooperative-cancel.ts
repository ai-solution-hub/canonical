/**
 * Cooperative-cancellation allow-list for queue job types — Session 225 W1-IMPL.
 *
 * Spec sources:
 *   - `docs/specs/§5.4.2-batch-reclassify-spec.md` §10 D-9 (cooperative
 *     cancellation between items, ratified May 5 2026; poll cadence=10).
 *
 * Most queue job types inherit §5.4.1's hard-409 policy on `'processing'`
 * cancellation: the cancel route returns 409 ("This job is already running
 * and cannot be cancelled.") for any in-flight job, because for a 60s-bounded
 * job-type the next claim opportunity is at most a one-minute wait.
 *
 * `batch_reclassify` opts in to cooperative cancellation because the job is
 * intentionally hours-long (5,000-item workspace × 3-5s/item × 60s-tick fan-out
 * = ~5-6h). Operators who realise mid-run that their filter was wrong (a
 * `domain` typo, a misclassified eval-rule) cannot wait it out. Per
 * `feedback_eval_prompt_rules_surgical`: a misconfigured eval-driven
 * reclassify can regress historical classifications across the workspace,
 * so a "stop now" mechanism is load-bearing UX.
 *
 * Implementation pattern:
 *   - The cancel route widens its UPDATE policy ONLY for job-types in this
 *     allow-list (preserves §5.4.1 hard-409 semantics for everyone else).
 *   - The handler polls `processing_queue.status` for the current job_id
 *     between work units (cadence per spec: batch_reclassify=10 items).
 *   - On `status='cancelled'`: handler breaks the loop, returns the partial
 *     result envelope. The dispatch case-clause finalises `pipeline_runs`
 *     with `status='completed_with_errors'` + `error_message='cancelled
 *     mid-run after N/M units'` per D-9.1 (no new enum value).
 *   - Race-safe: the cancel route's UPDATE uses `.in('status', [...])`
 *     filter so a worker claim between SELECT and UPDATE doesn't double-
 *     transition; the handler's poll is best-effort and tolerates a missed
 *     transition (the next poll-tick re-checks).
 */

import type { JobType } from '@/lib/queue/envelope';

/**
 * Job types that opt in to cooperative cancellation. The cancel route checks
 * this list to decide whether `'processing'` jobs are cancellable. Members
 * of this allow-list must implement an inter-unit poll on
 * `processing_queue.status` for the current job_id.
 *
 * Members:
 *   - `'batch_reclassify'` — added S225 W1-IMPL per §5.4.2 D-9 (cadence=10 items).
 *
 * (The legacy upload-markdown-batch job type was a member, added S226 per
 * §5.4.4 D-8, but was removed by ID-46.11 — that path is superseded by
 * ID-56.12 folder-drop ingest.)
 */
const COOPERATIVELY_CANCELLABLE_JOB_TYPES: ReadonlyArray<JobType> = [
  'batch_reclassify',
];

/**
 * Returns true if the given job type opts in to cooperative cancellation.
 * Jobs returning false fall back to the §5.4.1 hard-409 policy: the cancel
 * route refuses to cancel `'processing'` rows.
 *
 * @param jobType The job type to check (typed as JobType for type-safety;
 *   string callers must cast first).
 * @returns true if the job type can be cancelled mid-flight.
 */
export function canCooperativelyCancel(jobType: JobType): boolean {
  return COOPERATIVELY_CANCELLABLE_JOB_TYPES.includes(jobType);
}
