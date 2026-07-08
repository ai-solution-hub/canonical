-- ID-130 {130.28} — rename content_items-era column NAMES to honest post-{131.16} names.
--
-- THE BUG (owner ruling S452, fix-don't-leave): {131.16} re-pointed the arrays
-- these two columns hold from the retired `content_items` table onto
-- `q_a_pairs` (primary) + `reference_items` (optional) — but kept the OLD
-- `*_content_ids` column NAMES, so the schema still reads as if it stores
-- content_items ids. Data is transient pre-launch (zero data-preservation
-- effort mandated) — this is a pure rename, no backfill/rekey needed.
--
--   form_questions.matched_content_ids  -> matched_record_ids
--   form_responses.source_content_ids   -> source_record_ids
--
-- OUT OF SCOPE (deliberately NOT renamed here): `form_response_history`'s OWN
-- `source_content_ids` column (a version-snapshot mirror of
-- `form_responses.source_content_ids`, populated by the
-- `snapshot_form_response_history()` trigger below) is the SAME content_items-
-- era stale name but was not named in the {130.28} brief's two-column scope.
-- Left as-is; flagged as a follow-up finding for the Curator. The trigger
-- function below is still updated in this migration (mandatory consequence of
-- the form_responses rename, not scope creep) — only the VALUE it reads
-- changes (`OLD.source_record_ids`), not the history table's own column name
-- it writes into (`source_content_ids`, unchanged).
--
-- DR-030 (api.* view regen) + DR-032 (companion exposure, same migration): a
-- base-column RENAME does not auto-update a view's SELECT-list column alias,
-- so `api.form_questions` and `api.form_responses` are DROP+CREATE'd below
-- with the new names (CREATE OR REPLACE VIEW cannot rename a column in
-- place). `api.form_response_history` is NOT touched — its underlying
-- column name is unchanged. No other api.* view or function references either
-- old name (grep-verified across every `*api_views*`/`*_api_rpcs*` migration
-- and the full `supabase/migrations/*.sql` corpus).
--
-- CALLER SWEEP: full TS caller sweep (ast-dataflow column-reads/writes +
-- literal grep across app/lib/components/hooks/types/scripts/__tests__) done
-- in the same commit — see the commit message / journal for counts. No Python
-- (cocoindex pipeline) or other SQL migration references either old name
-- (grep-verified).
SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- STEP 1: base-table column renames
-- ---------------------------------------------------------------------------
ALTER TABLE public.form_questions
  RENAME COLUMN matched_content_ids TO matched_record_ids;

ALTER TABLE public.form_responses
  RENAME COLUMN source_content_ids TO source_record_ids;

-- ---------------------------------------------------------------------------
-- STEP 2: fix the ONE live function whose body references the renamed
-- form_responses column. CREATE OR REPLACE FUNCTION preserves the existing
-- ACL (unlike DROP+CREATE), so no REVOKE/GRANT re-statement is needed here —
-- the DR-035 born-locked event trigger also re-fires on this REPLACE and
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
      review_status, metadata, source_content_ids, edited_by, change_reason
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
-- STEP 3: api.* view regen (DR-030) for the two affected views only — column
-- lists mirror the latest regen (20260706150000_id131_api_views_regen2.sql)
-- verbatim except for the renamed column.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS api.form_questions;
CREATE VIEW api.form_questions WITH (security_invoker = true) AS
  SELECT
    id,
    workspace_id,
    section_name,
    section_sequence,
    question_sequence,
    question_text,
    word_limit,
    evaluation_weight,
    confidence_posture,
    matched_record_ids,
    status,
    has_variants,
    assigned_to,
    created_by,
    created_at,
    updated_at,
    template_requirement_id,
    form_template_id
  FROM public.form_questions;
GRANT SELECT ON api.form_questions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_questions TO service_role;

DROP VIEW IF EXISTS api.form_responses;
CREATE VIEW api.form_responses WITH (security_invoker = true) AS
  SELECT
    id,
    question_id,
    version,
    response_text,
    response_text_advanced,
    source_record_ids,
    review_status,
    drafted_by,
    last_edited_by,
    approved_by,
    metadata,
    created_at,
    updated_at,
    overall_score
  FROM public.form_responses;
GRANT SELECT ON api.form_responses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_responses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_responses TO service_role;
