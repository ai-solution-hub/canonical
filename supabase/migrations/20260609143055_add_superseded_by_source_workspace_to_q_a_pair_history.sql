-- =============================================================================
-- ID-64.15 (S330, promoted from bl-74) — extend q_a_pair_history with
-- superseded_by + source_workspace_id (pre-promotion gate G3 for ID-45 UC5).
-- =============================================================================
--
-- q_a_pairs already carries superseded_by (-> q_a_pairs(id)) and
-- source_workspace_id (-> workspaces(id)) (added in the T2 combined migration
-- 20260520120828). The q_a_pair_history snapshot table omitted both, and the
-- AFTER-UPDATE history-snapshot trigger (q_a_pairs_history_trigger) did not copy
-- them. History is append-only — these columns MUST land before the ID-45 UC5
-- promotion or supersession lineage and source-workspace provenance are lost
-- forever (a late-added column captures nothing for rows already snapshotted).
--
-- FK-vs-plain-uuid decision: PLAIN uuid (no FK). q_a_pair_history is an
-- append-only SNAPSHOT mirror written from the OLD row inside a SECURITY DEFINER
-- trigger. A FK on superseded_by (-> q_a_pairs(id)) or source_workspace_id
-- (-> workspaces(id)) would couple immutable historical snapshots to the live
-- referential surface:
--   * If a referenced pair/workspace is later hard-deleted, a subsequent UPDATE
--     to the source pair would write a snapshot whose FK target no longer
--     exists — the FK would BLOCK the append-only insert (history loss).
--   * ON DELETE SET NULL would instead mutate already-written immutable history
--     rows, violating the append-only invariant.
-- Lineage in a snapshot mirror is preserved by VALUE, not by referential
-- integrity. This matches the existing q_a_pair_history precedent: its only FKs
-- are structural (q_a_pair_id CASCADE for cleanup, changed_by SET NULL for
-- audit); value/lineage columns (origin_kind, publication_status) carry no FK
-- and no CHECK on the history table (per ID-64.2 S296 note). Plain uuid is the
-- consistent, safe choice.

-- -----------------------------------------------------------------------------
-- 1. Add the two lineage columns (plain uuid, nullable — match q_a_pairs
--    nullability; both are NULL on q_a_pairs).
-- -----------------------------------------------------------------------------
ALTER TABLE public.q_a_pair_history
  ADD COLUMN IF NOT EXISTS superseded_by uuid NULL,
  ADD COLUMN IF NOT EXISTS source_workspace_id uuid NULL;

COMMENT ON COLUMN public.q_a_pair_history.superseded_by IS
  'Snapshot of q_a_pairs.superseded_by at transition (plain uuid, no FK — append-only snapshot mirror, lineage preserved by value). ID-64.15.';
COMMENT ON COLUMN public.q_a_pair_history.source_workspace_id IS
  'Snapshot of q_a_pairs.source_workspace_id at transition (plain uuid, no FK — append-only snapshot mirror, provenance preserved by value). ID-64.15.';

-- -----------------------------------------------------------------------------
-- 2. CREATE OR REPLACE the history-snapshot trigger function to ALSO copy
--    OLD.superseded_by + OLD.source_workspace_id into the inserted history row.
--    Every existing copied column is preserved. The function snapshots the OLD
--    row (pre-update state) per the original T6 design (20260520225456) — so we
--    copy OLD.* for the two new columns to match.
--    SET search_path = public, extensions re-asserted (CLAUDE.md function rule).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.q_a_pairs_history_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions
AS $$
DECLARE
  v_next_version integer;
BEGIN
  -- Only fire on UPDATE (guard belt-and-suspenders; trigger is AFTER UPDATE)
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Compute next sequential version for this q_a_pair_id
  SELECT COALESCE(MAX(version), 0) + 1
    INTO v_next_version
    FROM public.q_a_pair_history
   WHERE q_a_pair_id = OLD.id;

  -- Insert OLD row snapshot into history (now incl. superseded_by + source_workspace_id)
  INSERT INTO public.q_a_pair_history (
    q_a_pair_id,
    version,
    question_text,
    alternate_question_phrasings,
    answer_standard,
    answer_advanced,
    scope_tag,
    anti_scope_tag,
    origin_kind,
    publication_status,
    superseded_by,
    source_workspace_id,
    valid_from,
    valid_to,
    changed_at,
    changed_by
  ) VALUES (
    OLD.id,
    v_next_version,
    OLD.question_text,
    OLD.alternate_question_phrasings,
    OLD.answer_standard,
    OLD.answer_advanced,
    OLD.scope_tag,
    OLD.anti_scope_tag,
    OLD.origin_kind,
    OLD.publication_status,
    OLD.superseded_by,
    OLD.source_workspace_id,
    OLD.valid_from,
    OLD.valid_to,
    now(),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

-- Per RLS-PATTERN P-4 + CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha +
-- bl-231: a PUBLIC grant survives an anon-only revoke. Re-assert both REVOKEs
-- after CREATE OR REPLACE (which resets the ACL to the pg_default_acl baseline).
REVOKE EXECUTE ON FUNCTION public.q_a_pairs_history_trigger() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.q_a_pairs_history_trigger() FROM anon;

-- Trigger binding (q_a_pairs_history_on_update) is unchanged — the AFTER UPDATE
-- trigger already references q_a_pairs_history_trigger() by name, so CREATE OR
-- REPLACE swaps the body in place with no re-bind needed.
