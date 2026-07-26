/**
 * The processing_queue job types owned by the Python bid worker
 * (scripts/bid_worker.py) rather than the app's cron consumer
 * (app/api/cron/process-queue/route.ts).
 *
 * ID-372 {372.2}: the queue has two consumers with disjoint type coverage.
 * Each claims with a type scope so it can never destroy the other's jobs:
 * the cron passes this list as `p_exclude_job_types` (keeping its
 * PermanentJobError default as the loud dead-letter for genuinely
 * unhandled types), and bid_worker.py passes the same two types as its
 * `p_job_types` include list.
 *
 * scripts/bid_worker.py mirrors this list as a Python literal
 * (WORKER_JOB_TYPES) — the two are pinned together by
 * scripts/tests/test_bid_worker.py's parity test, so an edit to either
 * side without the other fails CI.
 */
export const WORKER_JOB_TYPES = ['template_fill', 'analyse_form'] as const;
