-- ID-130 {130.27} — form_template_id write-side stamp: backfill + recurrence guard.
--
-- THE BUG: form_questions rows created via the live tender-upload extraction path
-- (app/api/procurement/[id]/questions/extract/route.ts) and the manual/batch
-- add-a-question paths (app/api/procurement/[id]/questions/route.ts) were written
-- with workspace_id ONLY -- form_template_id was populated ONCE by the {130.8}
-- backfill (20260625150000_id130_data.sql STEP 9b) and has drifted NULL on every
-- insert since. outcome/route.ts's KB-integration query and the win-rate RPCs
-- (get_content_win_rate / get_aggregate_win_rate_stats,
-- 20260625140000_id130_winrate.sql) INNER JOIN
-- form_questions.form_template_id -> form_templates.id, so a NULL-drifted row is
-- silently DROPPED from both, without erroring.
--
-- THE FIX ({130.27}, this Task wave):
--   1. (app code, same commit) every live form_questions insert/upsert site now
--      stamps form_template_id via lib/domains/procurement/resolve-form-template.ts,
--      which resolves the workspace's earliest-created form_templates row --
--      mirroring outcome/route.ts's existing "the workspace's single v1 form"
--      resolution -- and mints one on demand (ingest_source='app_upload') when
--      the workspace has none yet (the live tender-upload UI flow never creates
--      a form_templates row itself -- only the explicit "add a form" action or a
--      cocoindex-pipeline ingest does, so this is the COMMON case, not an edge
--      case).
--   2. STEP 1 below backfills every currently-NULL form_questions row the same
--      way, mirroring {130.8}'s STEP 9b re-key shape.
--   3. STEP 2 below adds a BEFORE INSERT recurrence-guard trigger: defense in
--      depth for any insert path this Subtask's app-code sweep missed (or a
--      future one that forgets to call resolveOrMintFormTemplateId()).
--
-- NOT NULL deliberately NOT added on form_questions.form_template_id:
-- scripts/seed-synthetic-corpus.ts inserts form_questions with form_template_id
-- intentionally NULL -- it exists to validate the {130.8} migration's OWN
-- mint-and-rekey steps (STEP 9a/9b) against workspaces that mimic the live
-- pre-backfill state, and a NOT NULL constraint would break that fixture outright.
-- (The trigger below is a no-op for that fixture at insert time anyway: its
-- synthetic workspaces carry zero form_templates rows at seed time, so there is
-- nothing to resolve against -- same observed NULL result as before this
-- migration.) Per the {130.27} brief: NOT NULL is only safe when EVERY insert
-- site stamps the column, and this one deliberately does not.
--
-- MULTI-FORM CAVEAT (v1 1:1 assumption): a workspace CAN carry more than one
-- form_templates row post-{130.8} (the explicit "add a form" action in
-- forms/route.ts, or an uploaded fill-in template via templates/route.ts). Both
-- STEP 1 and STEP 2 below resolve to the EARLIEST-created form_templates row per
-- workspace_id -- exactly matching the resolution outcome/route.ts already uses
-- for "the workspace's single v1 form" (order by created_at ascending, take the
-- first row). This is a consistency choice, not a new assumption: a future
-- multi-form-aware v2 would need to revisit both the app resolver AND this
-- backfill/trigger pair together.
--
-- Idempotent / re-runnable on staging or prod:
--   * STEP 1 is a plain UPDATE guarded by fq.form_template_id IS NULL -- a
--     re-apply re-selects the same earliest form per workspace and sets the
--     same value (no-op on a clean re-run).
--   * STEP 2 uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS / CREATE
--     TRIGGER -- safe to re-run.
-- No explicit BEGIN/COMMIT: each migration already runs in the push harness's
-- own transaction (matches the {130.5}/{130.6}/{130.7}/{130.8} sibling files).
--
-- Owner ruling (decision oq-961ad0eb240fb2a1 + owner steer): all Platform/client
-- DB data is TRANSIENT pre-launch (zero data-preservation effort required for
-- this backfill); migration + STAGING apply are GRANTED this wave.

-- ============================================================================
-- STEP 1 — backfill existing NULL-drifted form_questions rows.
-- Mirrors {130.8}'s STEP 9b shape (20260625150000_id130_data.sql), but resolves
-- the EARLIEST-created form per workspace_id via DISTINCT ON rather than a bare
-- join. {130.8} ran when the mint-guard (its STEP 9a NOT EXISTS) guaranteed
-- exactly one form per workspace, so a bare join was a safe 1:1. forms/route.ts's
-- "add a form" action (landed after {130.8}) means a workspace can now carry
-- more than one form_templates row, so a bare join here could non-deterministically
-- match a NON-canonical form for a multi-form workspace. DISTINCT ON
-- (workspace_id) ... ORDER BY created_at makes the "earliest form" resolution
-- explicit and deterministic, matching the app-level resolver.
-- ============================================================================
UPDATE "public"."form_questions" "fq"
SET "form_template_id" = "ft"."id"
FROM (
    SELECT DISTINCT ON ("workspace_id") "id", "workspace_id"
    FROM "public"."form_templates"
    ORDER BY "workspace_id", "created_at" ASC
) "ft"
WHERE "ft"."workspace_id" = "fq"."workspace_id"
  AND "fq"."form_template_id" IS NULL;

-- ============================================================================
-- STEP 2 — BEFORE INSERT recurrence-guard trigger (defense in depth).
-- Auto-resolves form_template_id from the workspace's earliest-created
-- form_templates row when a caller leaves it NULL. A no-op (leaves NULL) when
-- the workspace has no form_templates row yet -- only the app-level
-- resolveOrMintFormTemplateId() mint path can create the FIRST form for a
-- workspace (it needs a real filename/storage_path/mime_type to mint one; a
-- generic SQL trigger has no such context). This trigger is a backstop, not a
-- replacement for the app-level stamp.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."form_questions_resolve_form_template_id"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'extensions'
AS $$
BEGIN
    IF NEW."form_template_id" IS NULL THEN
        SELECT "id" INTO NEW."form_template_id"
        FROM "public"."form_templates"
        WHERE "workspace_id" = NEW."workspace_id"
        ORDER BY "created_at" ASC
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."form_questions_resolve_form_template_id"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."form_questions_resolve_form_template_id"() IS 'ID-130 {130.27} — BEFORE INSERT recurrence guard: auto-resolves form_questions.form_template_id from the workspace''s earliest-created form_templates row when a caller leaves it NULL. No-op (leaves NULL) when the workspace has no form_templates row yet — only the app-level resolveOrMintFormTemplateId() (lib/domains/procurement/resolve-form-template.ts) can mint the first one. Defense in depth alongside the app-level write-time stamp, not a substitute for it.';

-- Mirrors the form_response_auto_version() trigger-function grant shape
-- (20260624130000_id61_unit_e_db_bid_to_procurement.sql): triggers fire via
-- the function OWNER's privileges regardless of the DML caller's role, so
-- revoking EXECUTE here hardens against DIRECT invocation only -- it does not
-- (and must not) stop the trigger firing for authenticated/service_role
-- inserts.
REVOKE ALL ON FUNCTION "public"."form_questions_resolve_form_template_id"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."form_questions_resolve_form_template_id"() FROM "anon";
GRANT ALL ON FUNCTION "public"."form_questions_resolve_form_template_id"() TO "service_role";

DROP TRIGGER IF EXISTS "form_questions_resolve_form_template_id_trigger" ON "public"."form_questions";
CREATE TRIGGER "form_questions_resolve_form_template_id_trigger"
    BEFORE INSERT ON "public"."form_questions"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."form_questions_resolve_form_template_id"();
