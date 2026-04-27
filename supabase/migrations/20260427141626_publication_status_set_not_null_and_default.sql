-- §5.2 Phase 1d + 1e — Lock publication_status: SET NOT NULL + DEFAULT 'published'.
--
-- Final lock-in migration for the publication_status column added by T1
-- (20260427125412) and backfilled by T2 (20260427125413). Two atomic steps:
--   Phase 1d: Defensive verification that zero NULLs remain (RAISE
--             EXCEPTION otherwise — clearer than the implicit ALTER COLUMN
--             SET NOT NULL failure that would surface a less actionable
--             "column ... contains null values" message).
--   Phase 1e: ALTER COLUMN ... SET DEFAULT 'published' + ALTER COLUMN
--             ... SET NOT NULL. After this point, any new INSERT to
--             content_items that omits publication_status lands with
--             'published'.
--
-- Phases 1d and 1e are bundled in one file (atomic "lock the column"
-- step) per plan T3 and per spec §10.1 Phase 1e.
--
-- Spec sections: §4.1, §4.2.1 Phase 1e, §10.1 Phase 1d + 1e. Plan: T3.
-- Acceptance criteria: AC1.3 (DEFAULT applies to omitted-column inserts),
--   AC1.4 (zero NULLs reconfirmed pre-lock).

BEGIN;

-- Phase 1d: Defensive guard. Refuse to apply if T2's backfill is
-- incomplete. Better to RAISE clearly here than to let SET NOT NULL
-- surface a generic constraint-violation error.
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  SELECT count(*) INTO null_count
  FROM public.content_items
  WHERE publication_status IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to SET NOT NULL: % content_items rows still have NULL publication_status. '
      'T2 backfill (20260427125413_backfill_publication_status.sql) appears incomplete. '
      'Investigate before re-applying.',
      null_count;
  END IF;
END
$$;

-- Phase 1e step 1: Set the column DEFAULT before flipping NOT NULL.
-- (Order matters only by convention here — DEFAULT does not retroactively
-- backfill; T2 already populated every row.)
ALTER TABLE public.content_items
  ALTER COLUMN publication_status SET DEFAULT 'published';

-- Phase 1e step 2: Lock the column NOT NULL. From this point forward,
-- inserts must either set publication_status explicitly or rely on the
-- DEFAULT applied above.
ALTER TABLE public.content_items
  ALTER COLUMN publication_status SET NOT NULL;

-- Refresh the column comment to reflect the now-locked state. The
-- previous comment still referenced the "nullable until T2/T3" interim
-- state; this one captures the steady state.
COMMENT ON COLUMN public.content_items.publication_status IS
  'Publication lifecycle state per §5.2 spec. Values: draft, in_review, published, archived. NOT NULL with DEFAULT ''published''. CHECK enum enforced by content_items_publication_status_check.';

COMMIT;
