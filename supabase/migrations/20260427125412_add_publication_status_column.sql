-- §5.2 Phase 1a + 1b — Add publication_status column to content_items.
--
-- Adds nullable TEXT column with CHECK constraint enforcing the 4-value enum
-- {'draft','in_review','published','archived'}. The column stays nullable
-- until the T2 backfill runs; T3 (separate plan; not shipped here) will
-- add NOT NULL + DEFAULT 'published' after backfill verifies zero NULLs.
--
-- Rationale (per spec §4.1):
--   - TEXT + CHECK matches the existing project convention (cf.
--     governance_review_status, dedup_status). Avoids the ALTER TYPE ADD
--     VALUE friction that PostgreSQL ENUM types introduce when extending
--     enum values in future migrations.
--   - Column is nullable initially so ADD COLUMN does not rewrite the
--     ~600-row table with a default; backfill is per-cohort UPDATEs in T2.
--
-- Spec sections: §4.1, §10.1 Phase 1a + 1b. Plan: T1.
-- Acceptance: AC1.1 (column + CHECK exist), AC1.2 (CHECK rejects unknown
--   states).

-- Phase 1a: Add publication_status column.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS publication_status TEXT NULL;

-- Phase 1b: Add CHECK constraint.
-- Defensive: drop-then-add so re-running this migration on an instance
-- where the constraint already exists (e.g. branch resets, cherry-picks)
-- does not error. The DROP is a no-op when the constraint is absent.
ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_publication_status_check;

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_publication_status_check
  CHECK (publication_status IS NULL
         OR publication_status = ANY (
             ARRAY['draft', 'in_review', 'published', 'archived']
         ));

COMMENT ON COLUMN public.content_items.publication_status IS
  'Publication lifecycle state per §5.2 spec. Values: draft, in_review, published, archived. Nullable until T2 backfill + T3 SET NOT NULL land.';
