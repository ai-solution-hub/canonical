-- §5.2 Phase 1f (T9) — drop 'draft' from governance_review_status CHECK enum.
--
-- Background:
--   Phase 2.5 (T8a + T8b in S202) rewired every production writer of
--   governance_review_status='draft' to publication_status='draft'. The
--   AC6.5 grep guard test (commits fba1cc2e + 086d8bd1) enforces zero
--   regressions to the legacy column at write positions. Phase 1f closes
--   the dual-state ambiguity by removing 'draft' from the legacy CHECK
--   enum entirely.
--
--   After T9, draft is exclusively a publication_status value;
--   governance_review_status is review-cycle-only:
--     pending, approved, reverted, changes_requested, review_overdue.
--
-- Pre-flight verification (run via execute_sql before pushing):
--   1. SELECT COUNT(*) FROM content_items WHERE governance_review_status='draft'
--      → expected 0 on both rovrymhhffssilaftdwd (prod) and turayklvaunphgbgscat
--      (staging). If non-zero, the UPDATE below NULLs them — but the count
--      should be confirmed zero post-T8a as defence-in-depth.
--   2. AC6.5 guard test green:
--      `bun run test -- draft-writer-rewire-guard` → 15 passes.
--   3. §5.5 Phase 1 already shipped (S200) — surviving CHECK array
--      hardcodes 'review_overdue' which depends on §5.5 P1 having added it.
--      Confirmed via pg_get_constraintdef on prod: 6-value array currently
--      contains 'review_overdue'.
--
-- Spec: docs/specs/publication-lifecycle-state-machine-spec.md §4.2.2, §10.6 Phase 1f, AC1.9.
-- Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T9.

-- Step 1: NULL legacy 'draft' rows (defence-in-depth — production rewire
-- already shipped). On both prod + staging the count is 0, so this is a no-op
-- in practice but kept for replay safety.
UPDATE content_items
SET governance_review_status = NULL
WHERE governance_review_status = 'draft';

-- Step 2: Drop existing 6-value CHECK constraint.
ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_governance_review_status_check;

-- Step 3: Re-add CHECK with 5 values (no 'draft').
ALTER TABLE content_items
  ADD CONSTRAINT content_items_governance_review_status_check
  CHECK (
    (governance_review_status IS NULL)
    OR (governance_review_status = ANY (ARRAY[
      'pending'::text,
      'approved'::text,
      'reverted'::text,
      'changes_requested'::text,
      'review_overdue'::text
    ]))
  );
