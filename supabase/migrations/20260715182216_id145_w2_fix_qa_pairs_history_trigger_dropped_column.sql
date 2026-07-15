-- ID-145 {145.23} round-2 — tsc-INVISIBLE runtime defect found while
-- adjudicating app/api/q-a-pairs/[id]/workspace/route.ts (mandatory extra
-- #4): W1c (20260712062000_id145_w1c_rename_reshape.sql) DROPPED
-- q_a_pairs.source_workspace_id (data lineage-migrated onto
-- source_form_instance_id in the preceding w1a migration) but did NOT
-- update public.q_a_pairs_history_trigger(), which still unconditionally
-- reads OLD.source_workspace_id in its INSERT INTO q_a_pair_history.
--
-- PL/pgSQL resolves RECORD field access (OLD.<col>) at EXECUTION time, not
-- at CREATE FUNCTION time, so this compiled cleanly but now hard-fails
-- ("record \"old\" has no field \"source_workspace_id\"") on EVERY UPDATE to
-- q_a_pairs — not just procurement-scoped writes. Empirically confirmed live
-- on staging (rbwqewalexrzgxtvcqrh): q_a_pairs has no source_workspace_id
-- column; pg_proc.prosrc for q_a_pairs_history_trigger still references it.
--
-- Fix: drop source_workspace_id from both the INSERT column list and the
-- VALUES list. q_a_pair_history.source_workspace_id itself is UNTOUCHED
-- (still a real column, still holds historical snapshot values for
-- pre-W1 versions per its append-only/write-once-forward design) — only the
-- live snapshot-on-UPDATE write of a now-nonexistent source column stops.
-- No data loss: no live q_a_pairs row has carried this column since W1c.
CREATE OR REPLACE FUNCTION "public"."q_a_pairs_history_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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
  -- (incl. bl-74 superseded_by AND ID-59 edit_intent; source_workspace_id
  -- DROPPED from q_a_pairs at W1c ({145.23} round-2) -- no longer snapshotted
  -- going forward, historical rows retain their pre-W1 values)
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
    OLD.edit_intent,
    OLD.valid_from,
    OLD.valid_to,
    now(),
    auth.uid()
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."q_a_pairs_history_trigger"() OWNER TO "postgres";

COMMENT ON COLUMN "public"."q_a_pair_history"."source_workspace_id" IS 'Snapshot of q_a_pairs.source_workspace_id at transition (plain uuid, no FK -- append-only snapshot mirror, provenance preserved by value). ID-64.15. FROZEN post-{145.23} round-2: q_a_pairs.source_workspace_id was DROPPED at W1c (workspace lineage retired system-wide) -- this column no longer receives new snapshots, historical pre-W1 values are retained as-is.';
