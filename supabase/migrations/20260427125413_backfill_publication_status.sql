-- §5.2 Phase 1c — Backfill publication_status for existing content_items rows.
--
-- Four-step UPDATE sequence per spec §4.2.1 + §10.1. Each step has
-- WHERE publication_status IS NULL so subsequent steps only touch rows
-- not already classified — i.e. step ORDER defines precedence:
--   1. governance_review_status='draft'  → 'draft'
--   2. archived_at IS NOT NULL           → 'archived'
--   3. superseded_by IS NOT NULL         → 'archived'
--   4. all remaining                     → 'published'
--
-- This implements spec §10.1 SQL verbatim (draft wins over archived/
-- superseded). On the production corpus (`r` 27/04/2026, 604 rows):
-- step 1 matches 0 rows, so the precedence question is moot for this
-- migration — but the SQL ordering is the spec contract for any future
-- corpus where draft+archived rows coexist.
--
-- Pre-flight cohort counts (verified via mcp__supabase__execute_sql
-- 27/04/2026 against project `rovrymhhffssilaftdwd`):
--   Total rows:                       604
--   Step 1 (governance='draft'):        0 → 'draft'
--   Step 2 (archived_at NOT NULL):     10 → 'archived'
--   Step 3 (superseded_by NOT NULL):    0 → 'archived' (no overlap)
--   Step 4 (remaining):               594 → 'published'
--   Post-migration NULLs expected:      0
--
-- Spec sections: §4.2.1, §10.1 Phase 1c. Plan: T2.
-- Acceptance: AC1.4 (zero NULLs), AC1.5–AC1.8 (per-cohort target column).

BEGIN;

-- Step 1: Items with governance_review_status='draft' map to 'draft'.
UPDATE public.content_items
SET publication_status = 'draft'
WHERE publication_status IS NULL
  AND governance_review_status = 'draft';

-- Step 2: Items with archived_at IS NOT NULL map to 'archived'.
UPDATE public.content_items
SET publication_status = 'archived'
WHERE publication_status IS NULL
  AND archived_at IS NOT NULL;

-- Step 3: Items with superseded_by IS NOT NULL map to 'archived'
-- (per spec §6.5 — supersession retires the old row; archive captures it).
UPDATE public.content_items
SET publication_status = 'archived'
WHERE publication_status IS NULL
  AND superseded_by IS NOT NULL;

-- Step 4: All remaining rows map to 'published' (the safe default; the
-- de facto state the platform currently treats them as).
UPDATE public.content_items
SET publication_status = 'published'
WHERE publication_status IS NULL;

-- Verify zero NULLs remain. Hard-fail rather than silently leak.
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  SELECT count(*) INTO null_count
  FROM public.content_items
  WHERE publication_status IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % content_items rows still have NULL publication_status. '
      'Investigate before applying the SET NOT NULL migration.',
      null_count;
  END IF;
END
$$;

COMMIT;
