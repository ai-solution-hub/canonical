-- ID-130 {130.30} — rename form_response_history's OWN source_content_ids
-- column to source_record_ids (same-class rename as {130.28}).
--
-- THE FOLLOW-UP: {130.28} renamed form_responses.source_content_ids ->
-- source_record_ids (migration 20260708130000) but deliberately left
-- form_response_history's own source_content_ids column untouched — it is a
-- version-snapshot mirror of form_responses.source_content_ids, populated by
-- the snapshot_form_response_history() trigger, and was out of that
-- Subtask's named two-column scope. {130.28} flagged it as a follow-up
-- finding for the Curator; routed here as {130.30}. Data is transient
-- pre-launch (zero data-preservation effort mandated) — this is a pure
-- rename, no backfill/rekey needed.
--
--   form_response_history.source_content_ids  -> source_record_ids
--
-- DR-030 (api.* view regen) + DR-032 (companion exposure, same migration): a
-- base-column RENAME does not auto-update a view's SELECT-list column alias,
-- so api.form_response_history is DROP+CREATE'd below with the new name
-- (CREATE OR REPLACE VIEW cannot rename a column in place). No other api.*
-- view or function references the old name (grep-verified across every
-- `*api_views*`/`*_api_rpcs*` migration and the full
-- `supabase/migrations/*.sql` corpus).
--
-- CALLER SWEEP: ast-dataflow + literal grep across
-- app/lib/components/hooks/types/scripts/__tests__ found exactly ONE TS
-- call site reading the column: app/api/procurement/[id]/responses/[rId]/
-- restore/route.ts (`historyRow.source_content_ids`). The other 4 files
-- named in the {130.30} brief (lib/reorient.ts, lib/dashboard.ts,
-- lib/activity/team-changes.ts,
-- app/api/procurement/[id]/responses/[rId]/history/route.ts) query
-- form_response_history but select explicit column lists that never include
-- this column — confirmed clean, no edit needed. No Python (cocoindex
-- pipeline) or other SQL migration references the old name.
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- STEP 1: base-table column rename
-- ---------------------------------------------------------------------------
ALTER TABLE public.form_response_history
  RENAME COLUMN source_content_ids TO source_record_ids;

-- ---------------------------------------------------------------------------
-- STEP 2: fix the ONE live function whose body references the renamed
-- form_response_history column (the INSERT target-column list only — the
-- VALUE side already reads OLD.source_record_ids off form_responses since
-- {130.28}). CREATE OR REPLACE FUNCTION preserves the existing ACL (unlike
-- DROP+CREATE), so no REVOKE/GRANT re-statement is needed here — the
-- DR-035 born-locked event trigger also re-fires on this REPLACE and
-- re-asserts REVOKE ... FROM PUBLIC, anon (a no-op given this trigger
-- function's existing posture: PUBLIC/anon already revoked by the DR-035
-- sweep, Postgres never ACL-checks EXECUTE for a firing trigger).
CREATE OR REPLACE FUNCTION public.snapshot_form_response_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
BEGIN
  IF OLD.response_text IS DISTINCT FROM NEW.response_text
     OR OLD.response_text_advanced IS DISTINCT FROM NEW.response_text_advanced
     OR OLD.metadata IS DISTINCT FROM NEW.metadata THEN

    INSERT INTO form_response_history (
      response_id, version, response_text, response_text_advanced,
      review_status, metadata, source_record_ids, edited_by, change_reason
    ) VALUES (
      OLD.id, OLD.version, OLD.response_text, OLD.response_text_advanced,
      OLD.review_status, OLD.metadata, OLD.source_record_ids,
      COALESCE(auth.uid(), NEW.last_edited_by),
      current_setting('app.change_reason', true)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- STEP 3: api.* view regen (DR-030) for the one affected view — column list
-- mirrors the latest regen (20260706150000_id131_api_views_regen2.sql)
-- verbatim except for the renamed column.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS api.form_response_history;
CREATE VIEW api.form_response_history WITH (security_invoker = true) AS
  SELECT
    id,
    response_id,
    version,
    response_text,
    response_text_advanced,
    review_status,
    metadata,
    source_record_ids,
    edited_by,
    change_reason,
    created_at
  FROM public.form_response_history;
GRANT SELECT ON api.form_response_history TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_response_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_response_history TO service_role;
