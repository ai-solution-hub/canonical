-- ID-130.6 — Roll-up recompute function + trigger (TECH §Migration plan step 7; T-B7, AD-2).
-- BOUNDARY: recompute fn + AFTER trigger on form_templates ONLY. NO win-rate engine rewrite
-- ({130.7}); NO data backfill / initial recompute of existing workspaces ({130.8} — the fn is
-- DEFINED here but the bulk initial recompute runs there); NO api.* view / types regen ({130.9}).
--
-- Depends on {130.5} spine (20260625120000_id130_spine.sql): form_outcome_types CV +
-- form_templates engagement columns (outcome, workflow_state, deadline, submission_date) +
-- procurement_workspaces rollup columns (nearest_deadline, overall_outcome,
-- counts_toward_win_rate, rollup_updated_at).
--
-- Derivation is VERBATIM from TECH AD-2 / PRODUCT B-7. The fn reads the form_outcome_types CV
-- (stage / counts_toward_win_rate) — it NEVER inlines a {itt,tender,bid,rfp} form_type list.

-- ============================================================================
-- STEP 7a — recompute_procurement_rollup(p_workspace_id uuid)
-- Idempotent UPSERT into procurement_workspaces. Runs correctly whether the rollup row
-- pre-exists or not (ON CONFLICT (workspace_id) — backed by procurement_workspaces_workspace_id_key
-- UNIQUE constraint, squash baseline L8403).
--
-- AD-2 derivation:
--   * nearest_deadline = MIN(deadline) across NON-terminal forms
--     (workflow_state NOT IN ('won','lost','withdrawn')); NULL when all terminal / no forms.
--   * overall_outcome: take the final-award-stage form = the latest form whose form_type joins
--     form_outcome_types at stage='final_award' ({itt,tender,bid,rfp}), ordered by deadline
--     (tie-break created_at). 'won' if that form's outcome won; 'lost' if it lost OR the
--     engagement is withdrawn OR any shortlist-stage form (stage='shortlist') resolved
--     'not_shortlisted' (P3 shortlist-failure => lost); 'in_progress' while no terminal final
--     outcome.
--   * counts_toward_win_rate = the engagement reached a counts_toward_win_rate=true form
--     (final_award stage) with a terminal won/lost outcome. (Shortlist losses set
--     overall_outcome='lost' but counts_toward_win_rate=false.)
--
-- All column refs are qualified (Unit-E 42P13 param-collision learning; the param is p_-prefixed
-- so it cannot collide with a column name regardless).
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."recompute_procurement_rollup"("p_workspace_id" "uuid")
RETURNS "void"
LANGUAGE "plpgsql"
SET "search_path" = 'public', 'extensions'
AS $$
DECLARE
    "v_nearest_deadline"      timestamp with time zone;
    "v_overall_outcome"       "text";
    "v_counts_toward_win_rate" boolean;
    "v_final_award_outcome"   "text";   -- outcome of the latest final-award-stage form
    "v_any_withdrawn"         boolean;   -- engagement has a withdrawn form
    "v_any_not_shortlisted"   boolean;   -- a shortlist-stage form resolved not_shortlisted (P3)
    "v_terminal_final_award"  boolean;   -- a counts_toward_win_rate final-award form hit won/lost
BEGIN
    -- nearest_deadline: MIN(deadline) over non-terminal forms.
    SELECT MIN("ft"."deadline")
      INTO "v_nearest_deadline"
      FROM "public"."form_templates" "ft"
     WHERE "ft"."workspace_id" = "p_workspace_id"
       AND "ft"."deadline" IS NOT NULL
       AND "ft"."workflow_state" NOT IN ('won', 'lost', 'withdrawn');

    -- final-award-stage form = latest form joining form_outcome_types at stage='final_award'
    -- (the CV's {itt,tender,bid,rfp} set, via applicable_form_types), ordered by deadline then
    -- created_at. We read that form's outcome. NULL deadlines sort last so a dated form wins the
    -- "latest" race over an undated one.
    SELECT "ft"."outcome"
      INTO "v_final_award_outcome"
      FROM "public"."form_templates" "ft"
      JOIN "public"."form_outcome_types" "fot"
        ON "fot"."stage" = 'final_award'
       AND "ft"."form_type" = ANY ("fot"."applicable_form_types")
     WHERE "ft"."workspace_id" = "p_workspace_id"
     ORDER BY "ft"."deadline" DESC NULLS LAST, "ft"."created_at" DESC
     LIMIT 1;

    -- engagement-level lost signals: a withdrawn form, or a shortlist-stage form resolved
    -- not_shortlisted (P3). Both resolve the ENGAGEMENT to lost per AD-2.
    SELECT EXISTS (
        SELECT 1
          FROM "public"."form_templates" "ft"
         WHERE "ft"."workspace_id" = "p_workspace_id"
           AND "ft"."workflow_state" = 'withdrawn'
    ) INTO "v_any_withdrawn";

    SELECT EXISTS (
        SELECT 1
          FROM "public"."form_templates" "ft"
          JOIN "public"."form_outcome_types" "fot"
            ON "fot"."key" = "ft"."outcome"
         WHERE "ft"."workspace_id" = "p_workspace_id"
           AND "fot"."stage" = 'shortlist'
           AND "ft"."outcome" = 'not_shortlisted'
    ) INTO "v_any_not_shortlisted";

    -- overall_outcome per AD-2:
    --   'won'  if the final-award form won;
    --   'lost' if the final-award form lost OR engagement withdrawn OR shortlist not_shortlisted;
    --   'in_progress' while no terminal final outcome.
    IF "v_final_award_outcome" = 'won' THEN
        "v_overall_outcome" := 'won';
    ELSIF "v_final_award_outcome" = 'lost'
       OR COALESCE("v_any_withdrawn", false)
       OR COALESCE("v_any_not_shortlisted", false) THEN
        "v_overall_outcome" := 'lost';
    ELSE
        "v_overall_outcome" := 'in_progress';
    END IF;

    -- counts_toward_win_rate (P2 denominator): the engagement reached a counts_toward_win_rate=true
    -- form (final_award stage per the CV) with a terminal won/lost outcome. Shortlist losses are
    -- counts_toward_win_rate=false in the CV, so they are excluded by construction.
    SELECT EXISTS (
        SELECT 1
          FROM "public"."form_templates" "ft"
          JOIN "public"."form_outcome_types" "fot"
            ON "fot"."key" = "ft"."outcome"
         WHERE "ft"."workspace_id" = "p_workspace_id"
           AND "fot"."counts_toward_win_rate" = true
           AND "ft"."outcome" IN ('won', 'lost')
    ) INTO "v_terminal_final_award";

    "v_counts_toward_win_rate" := COALESCE("v_terminal_final_award", false);

    -- Idempotent UPSERT. id/created_at use table defaults on INSERT; updated_at + rollup_updated_at
    -- bump on both paths so the cache timestamp is always fresh.
    INSERT INTO "public"."procurement_workspaces" (
        "workspace_id",
        "nearest_deadline",
        "overall_outcome",
        "counts_toward_win_rate",
        "rollup_updated_at",
        "updated_at"
    )
    VALUES (
        "p_workspace_id",
        "v_nearest_deadline",
        "v_overall_outcome",
        "v_counts_toward_win_rate",
        "now"(),
        "now"()
    )
    ON CONFLICT ("workspace_id") DO UPDATE SET
        "nearest_deadline"       = EXCLUDED."nearest_deadline",
        "overall_outcome"        = EXCLUDED."overall_outcome",
        "counts_toward_win_rate" = EXCLUDED."counts_toward_win_rate",
        "rollup_updated_at"      = EXCLUDED."rollup_updated_at",
        "updated_at"             = EXCLUDED."updated_at";
END;
$$;

ALTER FUNCTION "public"."recompute_procurement_rollup"("p_workspace_id" "uuid") OWNER TO "postgres";

-- ACL: leave the default (PUBLIC EXECUTE). The public schema is NOT exposed via the Data API
-- (db_schema = 'api'), so a public-schema fn is not anon-reachable — per
-- 20260624120000_id115_api_schema_anon_revoke.sql L27-30, public-schema residual grants are
-- latent defence-in-depth handled separately, NOT per-new-function. Default PUBLIC EXECUTE is
-- also safest for a trigger-invoked fn: it fires regardless of the writer's role, whereas an
-- explicit REVOKE-from-PUBLIC + narrow GRANT could break a write from an unlisted role.

COMMENT ON FUNCTION "public"."recompute_procurement_rollup"("p_workspace_id" "uuid") IS 'ID-130 T-B7/AD-2 — recompute the materialised roll-up row on procurement_workspaces for one workspace. Idempotent UPSERT (ON CONFLICT workspace_id). Reads the form_outcome_types CV for stage/denominator classification (never an inlined form_type list). nearest_deadline = MIN(deadline) over non-terminal forms; overall_outcome won/lost/in_progress per the latest final-award-stage form + withdrawn/not_shortlisted signals; counts_toward_win_rate = reached a counts_toward_win_rate=true form with a terminal won/lost outcome.';

-- ============================================================================
-- STEP 7b — AFTER trigger on form_templates engagement-column writes
-- Fires only on the low-frequency engagement-column writes (outcome, workflow_state, deadline,
-- submission_date) — NOT on question/response edits. Recomputes the parent workspace's rollup.
-- On DELETE / workspace_id change on UPDATE, recompute BOTH the old and new workspace.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."form_templates_recompute_rollup_trigger"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = 'public', 'extensions'
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM "public"."recompute_procurement_rollup"(OLD."workspace_id");
        RETURN OLD;
    END IF;

    -- INSERT or UPDATE: recompute the (new) parent workspace.
    PERFORM "public"."recompute_procurement_rollup"(NEW."workspace_id");

    -- If an UPDATE moved the form to a different workspace, the old parent also needs a recompute.
    IF TG_OP = 'UPDATE' AND NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" THEN
        PERFORM "public"."recompute_procurement_rollup"(OLD."workspace_id");
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."form_templates_recompute_rollup_trigger"() OWNER TO "postgres";

-- ACL: default (PUBLIC EXECUTE) retained — public schema is not Data-API-exposed (see the
-- recompute fn note above); default EXECUTE is also the safe posture for a trigger fn so it
-- fires regardless of the writer's role.

COMMENT ON FUNCTION "public"."form_templates_recompute_rollup_trigger"() IS 'ID-130 T-B7/AD-2 — AFTER-trigger fn that recomputes the parent procurement_workspaces rollup when a form''s engagement columns (outcome/workflow_state/deadline/submission_date) change. Recomputes OLD + NEW workspace on DELETE / workspace_id change.';

DROP TRIGGER IF EXISTS "form_templates_recompute_rollup" ON "public"."form_templates";
CREATE TRIGGER "form_templates_recompute_rollup"
    AFTER INSERT OR DELETE OR UPDATE OF "outcome", "workflow_state", "deadline", "submission_date"
    ON "public"."form_templates"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."form_templates_recompute_rollup_trigger"();

-- NOTE: the {130.5} fold-in anon-REVOKE on form_templates_outcome_form_type_check() was REMOVED
-- here — it was a false-positive Checker nit. public-schema fns are not Data-API-exposed
-- (db_schema = 'api'), so a per-function anon REVOKE is unnecessary; residual public-schema grants
-- are latent defence-in-depth addressed separately (20260624120000_id115_api_schema_anon_revoke.sql
-- L27-30), not per-new-function.
