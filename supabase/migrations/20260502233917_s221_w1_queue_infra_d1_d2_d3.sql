-- S221 W1-A — §5.4 background-queue infrastructure DDL.
--
-- Spec: docs/specs/background-queue-infra-spec.md v1 (Liam-ratified D-1, D-2, D-3 at S218 W4).
-- Plan: docs/plans/background-queue-infra-plan.md §1 W1, §3 D-1/D-2/D-3.
--
-- Lands the chokepoint contract on processing_queue WITHOUT speculatively
-- widening job_type. Per Liam OQ-3 (RATIFIED S221 W3 = NO speculative widen),
-- each §5.4.x candidate spec extends job_type CHECK with its own value when
-- its candidate spec dispatches. job_type CHECK stays at the existing 8 values
-- (the 6 pre-squash values + template_fill + template_analyse already in use).
--
-- Five steps:
--   1. ADD COLUMN idempotency_key text (D-1).
--   2. Partial UNIQUE index on idempotency_key WHERE status IN ('pending',
--      'processing', 'completed') (D-1).
--   3. Widen status CHECK to include 'dead_lettered' (D-2).
--   4. Cosmetic rename of constraint + index from task_type → job_type
--      (post-S180 column-rename drift cleanup; column was renamed in
--      20260419095200 but the constraint and index names lagged).
--   5. RLS policy reconciliation (D-3): drop existing lax SELECT (USING true)
--      + replace with admin-only; rename existing INSERT/UPDATE policies to
--      match the new naming convention (..._editor_admin / ..._admin); add
--      missing DELETE policy (admin-only).
--
-- NO new PL/pgSQL helpers in this migration — per OQ-3, enqueue_queue_job /
-- requeue_queue_job_with_backoff defer to W2 with the worker. Existing
-- claim_next_job already has REVOKE EXECUTE ... FROM anon per
-- 20260502143049_ops43_revoke_anon_execute_public_functions.sql:186.

-- Step 1 — Add idempotency_key column (D-1).
ALTER TABLE public.processing_queue
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Step 2 — Partial UNIQUE index (D-1). Covers 'completed' rows so that a
-- same-day producer retry returns the existing job_id (at-most-once invariant
-- for retries-after-completion). Producer formula MUST include a date/version
-- bucket per spec §5.5: `<job_type>:<scoped_id>:<YYYY-MM-DD>:<requestHash>`.
CREATE UNIQUE INDEX IF NOT EXISTS processing_queue_idempotency_key_uniq
  ON public.processing_queue (idempotency_key)
  WHERE status IN ('pending', 'processing', 'completed');

-- Step 3 — Widen status CHECK to include 'dead_lettered' (D-2). Dead-lettered
-- rows are not re-claimed by claim_next_job (filtered by status='pending'),
-- surface in the admin Sentry alert (§6.1), and are queryable for
-- manual-replay/manual-discard decisions.
ALTER TABLE public.processing_queue
  DROP CONSTRAINT IF EXISTS processing_queue_status_check;
ALTER TABLE public.processing_queue
  ADD CONSTRAINT processing_queue_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'dead_lettered'));

-- Step 4 — Cosmetic rename of constraint + index (post-squash drift cleanup).
-- The S180 migration renamed processing_queue.task_type → job_type but left
-- the constraint name (processing_queue_task_type_check) and index name
-- (idx_processing_queue_task_type) lagging. Bring them in line so the
-- artefact names match the column name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processing_queue_task_type_check'
      AND conrelid = 'public.processing_queue'::regclass
  ) THEN
    ALTER TABLE public.processing_queue
      RENAME CONSTRAINT processing_queue_task_type_check TO processing_queue_job_type_check;
  END IF;
END;
$$;

ALTER INDEX IF EXISTS public.idx_processing_queue_task_type
  RENAME TO idx_processing_queue_job_type;

-- Step 5 — RLS policy reconciliation (D-3).
--
-- Existing state (per 20260416102457_pre_squash_reconciliation.sql:6186-6197):
--   - RLS already enabled.
--   - processing_queue_insert: editor+admin INSERT (matches D-3).
--   - processing_queue_select: USING (true) — TOO LAX, must tighten to
--     admin-only per spec D-3.
--   - processing_queue_update: admin UPDATE (matches D-3).
--   - NO DELETE policy (gap to fill per D-3).
--
-- Reconciliation: drop the three existing policies and re-create with
-- consistent naming (..._editor_admin / ..._admin) and the corrected SELECT
-- scope. Add the missing DELETE policy.

ALTER TABLE public.processing_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processing_queue_insert ON public.processing_queue;
DROP POLICY IF EXISTS processing_queue_select ON public.processing_queue;
DROP POLICY IF EXISTS processing_queue_update ON public.processing_queue;

CREATE POLICY processing_queue_insert_editor_admin ON public.processing_queue
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('editor', 'admin'));

CREATE POLICY processing_queue_select_admin ON public.processing_queue
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

CREATE POLICY processing_queue_update_admin ON public.processing_queue
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY processing_queue_delete_admin ON public.processing_queue
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');
