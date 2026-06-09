-- =============================================================================
-- ID-59 {59.5} (S331) — edit_intent storage slice (PC-13 + PC-A4 storage half).
-- Serial-root migration for ID-59: add the edit_intent write-only-forward
-- substrate to content_history (+ arbitration_inputs jsonb) and to the Q&A
-- revision surface (q_a_pairs live + q_a_pair_history snapshot + trigger copy).
-- =============================================================================
--
-- STAGING-FIRST. PROD PUSH IS LIAM-GATED — deferred to the ID-45 cutover window.
-- Do NOT push this to prod from this Task.
--
-- All new columns are NULL-allowed, write-only-forward, with NO backfill and no
-- data migration (a C4 shape-only slice per RESEARCH §4.4). Pre-edit-feature
-- history rows legitimately carry NULL. The closed CV (cosmetic|data|structural)
-- is enforced by a CHECK; NULL is permitted (the CHECK passes on NULL).

-- -----------------------------------------------------------------------------
-- 1. content_history (PC-13 → INV-13) — edit_intent + arbitration_inputs.
--    Column-only ALTER: no new function, so NO REVOKE / SET search_path here.
--    RLS unchanged — content_history keeps its existing policies; these columns
--    inherit them. content_history is app-written, never a flow.py write target.
-- -----------------------------------------------------------------------------
ALTER TABLE public.content_history
  ADD COLUMN IF NOT EXISTS edit_intent text
    CHECK (edit_intent IN ('cosmetic', 'data', 'structural')),       -- NULL allowed
  ADD COLUMN IF NOT EXISTS arbitration_inputs jsonb;                  -- NULL allowed; [{actor,intent}]

COMMENT ON COLUMN public.content_history.edit_intent IS
  'Post-arbitration edit intent (S234 ONT.14 closed CV cosmetic|data|structural). Gates next-walk '
  're-classification per 02-data-flow §8.2. App-written only; NEVER pipeline-written. Write-only-forward '
  '— pre-edit-feature history rows legitimately NULL (no backfill).';
COMMENT ON COLUMN public.content_history.arbitration_inputs IS
  'Per-actor inputs when a CRDT merge arbitrated >1 intent: jsonb array of {actor: uuid, intent: text}. '
  'NULL for single-actor saves. Forensic reconstruction of the arbitration (INV-13).';

-- -----------------------------------------------------------------------------
-- 2. q_a_pairs (PC-A4 → INV-7 on the Q&A surface) — live edit_intent column.
--    Resolves + stamps edit_intent identically to PC-7 on the content surface.
-- -----------------------------------------------------------------------------
ALTER TABLE public.q_a_pairs
  ADD COLUMN IF NOT EXISTS edit_intent text
    CHECK (edit_intent IN ('cosmetic', 'data', 'structural'));       -- NULL allowed

COMMENT ON COLUMN public.q_a_pairs.edit_intent IS
  'Post-arbitration edit intent on the UC6 user-direct Q&A revision path (closed CV cosmetic|data|'
  'structural). NULL-allowed, write-only-forward (no backfill). Snapshotted into q_a_pair_history at '
  'each UPDATE via q_a_pairs_history_trigger(). ID-59 PC-A4.';

-- -----------------------------------------------------------------------------
-- 3. q_a_pair_history (PC-A4 → INV-7 snapshot) — edit_intent snapshot column.
--    The trigger copies OLD.edit_intent at UPDATE time, mirroring the other
--    audit columns. No FK; CHECK mirrors the live-table CV.
-- -----------------------------------------------------------------------------
ALTER TABLE public.q_a_pair_history
  ADD COLUMN IF NOT EXISTS edit_intent text
    CHECK (edit_intent IN ('cosmetic', 'data', 'structural'));       -- NULL allowed

COMMENT ON COLUMN public.q_a_pair_history.edit_intent IS
  'Snapshot of q_a_pairs.edit_intent at transition (closed CV cosmetic|data|structural). Written by '
  'q_a_pairs_history_trigger() copying OLD.edit_intent. NULL-allowed, write-only-forward. ID-59 PC-A4.';

-- -----------------------------------------------------------------------------
-- 4. CREATE OR REPLACE the history-snapshot trigger function to ALSO copy
--    OLD.edit_intent into the inserted history row.
--
--    LOAD-BEARING: this preserves the bl-74 / ID-64.15 columns
--    (superseded_by + source_workspace_id) added in 20260609143055. The body
--    below is the live staging body (verified via pg_get_functiondef) plus the
--    single new edit_intent copy line — it does NOT regress the bl-74 additions.
--
--    SET search_path = public, extensions is re-asserted (CLAUDE.md function
--    rule). REVOKE EXECUTE … FROM anon (+ PUBLIC) is re-issued after the
--    CREATE OR REPLACE resets the ACL to the pg_default_acl baseline
--    (CLAUDE.md anon-EXECUTE gotcha + bl-231: a PUBLIC grant survives an
--    anon-only revoke, so both REVOKEs are re-asserted).
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

  -- Insert OLD row snapshot into history
  -- (incl. bl-74 superseded_by + source_workspace_id AND ID-59 edit_intent)
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
    edit_intent,
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
    OLD.edit_intent,
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
