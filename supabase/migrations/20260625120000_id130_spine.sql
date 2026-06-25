-- ID-130.5 — Migration spine (additive DDL only).
-- Implements TECH §Migration plan steps 1-6: T-B2/T-B3/T-B4(additive)/T-B5/T-B12/T-B13/T-B21/T-B23, AD-1, AD-4.
-- Spine head — ordering is LAW: FK targets (form_outcome_types, form_templates) must exist before
-- the columns that reference them are added.
-- BOUNDARY: additive DDL only — NO recompute fn/trigger ({130.6}), NO win-rate rewrite ({130.7}),
-- NO data backfill / form minting / question re-keying ({130.8}), NO api.* view / types regen ({130.9}).

-- ============================================================================
-- STEP 1 — form_outcome_types controlled vocabulary + 4 seed rows (T-B2, AD-1)
-- Per-stage outcome CV. FK target for form_templates.outcome (step 2), so created first.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."form_outcome_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "stage" "text" NOT NULL,
    "applicable_form_types" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "counts_toward_win_rate" boolean DEFAULT false NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    CONSTRAINT "form_outcome_types_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "form_outcome_types_stage_check" CHECK (("stage" = ANY (ARRAY['shortlist'::"text", 'final_award'::"text"])))
);

ALTER TABLE "public"."form_outcome_types" OWNER TO "postgres";

COMMENT ON TABLE "public"."form_outcome_types" IS 'Controlled vocabulary of per-stage form outcomes (ID-130 AD-1). stage=shortlist resolves PSQ/questionnaire/checklist forms; stage=final_award resolves ITT/tender/bid/RFP forms. counts_toward_win_rate gates which outcomes feed the win-rate calculation ({130.7}).';

INSERT INTO "public"."form_outcome_types" ("key", "label", "stage", "applicable_form_types", "counts_toward_win_rate", "provenance")
VALUES
    ('shortlisted',     'Shortlisted',     'shortlist',    ARRAY['psq', 'questionnaire', 'checklist']::"text"[], false, 'core'),
    ('not_shortlisted', 'Not shortlisted', 'shortlist',    ARRAY['psq', 'questionnaire', 'checklist']::"text"[], false, 'core'),
    ('won',             'Won',             'final_award',  ARRAY['itt', 'tender', 'bid', 'rfp']::"text"[],       true,  'core'),
    ('lost',            'Lost',            'final_award',  ARRAY['itt', 'tender', 'bid', 'rfp']::"text"[],       true,  'core')
ON CONFLICT ("key") DO NOTHING;

-- ============================================================================
-- STEP 2 — form_templates engagement columns (T-B4 additive, T-B12, T-B13)
-- buyer REUSES existing issuing_organisation (no new col); deadline already present.
-- outcome_recorded_by is a BARE uuid (NO auth.users FK / NO REFERENCES) — house style
-- matching form_responses.drafted_by.
-- ============================================================================
ALTER TABLE "public"."form_templates"
    ADD COLUMN IF NOT EXISTS "outcome" "text",
    ADD COLUMN IF NOT EXISTS "outcome_recorded_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "outcome_recorded_by" "uuid",
    ADD COLUMN IF NOT EXISTS "outcome_notes" "text",
    ADD COLUMN IF NOT EXISTS "submission_date" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "workflow_state" "text" DEFAULT 'draft'::"text" NOT NULL;

-- outcome references the CV created in step 1 (added separately so ADD COLUMN IF NOT EXISTS stays clean).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "information_schema"."table_constraints"
        WHERE "constraint_name" = 'form_templates_outcome_fkey'
          AND "table_schema" = 'public'
          AND "table_name" = 'form_templates'
    ) THEN
        ALTER TABLE "public"."form_templates"
            ADD CONSTRAINT "form_templates_outcome_fkey"
            FOREIGN KEY ("outcome") REFERENCES "public"."form_outcome_types"("key");
    END IF;
END $$;

COMMENT ON TABLE "public"."form_templates" IS 'A FORM (tender/questionnaire/checklist artifact) owning questions, a deadline, and an outcome. Three ORTHOGONAL lifecycle axes (ID-130): status = analysis-pipeline lifecycle (uploaded -> analysing -> analysed -> filling -> completed); workflow_state = the 10-state procurement workflow (default draft); outcome = per-stage resolution (FK to form_outcome_types — shortlist vs final_award). buyer is recorded on issuing_organisation; the submission deadline on deadline.';

COMMENT ON COLUMN "public"."form_templates"."outcome" IS 'Per-stage resolution of this form (FK form_outcome_types.key). NULL = unresolved. ID-130 AD-1.';
COMMENT ON COLUMN "public"."form_templates"."outcome_recorded_at" IS 'When the outcome was recorded. NULL while outcome is NULL.';
COMMENT ON COLUMN "public"."form_templates"."outcome_recorded_by" IS 'User who recorded the outcome (bare uuid — house style per form_responses.drafted_by; no auth.users FK).';
COMMENT ON COLUMN "public"."form_templates"."outcome_notes" IS 'Free-text notes accompanying the recorded outcome.';
COMMENT ON COLUMN "public"."form_templates"."submission_date" IS 'When this form was submitted to the buyer (distinct from deadline). NULL = not yet submitted.';
COMMENT ON COLUMN "public"."form_templates"."workflow_state" IS 'The 10-state procurement workflow axis (default draft). Orthogonal to status (analysis-pipeline) and outcome (per-stage resolution). ID-130 T-B12.';

-- Optional cross-check: a recorded outcome must be applicable to the form_type.
-- form_type is NULLable (app_upload pre-classification) and outcome is NULLable, so the trigger
-- only fires when BOTH are present. SET search_path per house style.
CREATE OR REPLACE FUNCTION "public"."form_templates_outcome_form_type_check"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = 'public', 'extensions'
AS $$
DECLARE
    "v_applicable" "text"[];
BEGIN
    IF NEW."outcome" IS NULL OR NEW."form_type" IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT "applicable_form_types" INTO "v_applicable"
    FROM "public"."form_outcome_types"
    WHERE "key" = NEW."outcome";

    IF "v_applicable" IS NOT NULL AND NOT (NEW."form_type" = ANY ("v_applicable")) THEN
        RAISE EXCEPTION 'Outcome % is not applicable to form_type % (applicable: %)',
            NEW."outcome", NEW."form_type", "v_applicable";
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."form_templates_outcome_form_type_check"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "form_templates_outcome_form_type_check_trigger" ON "public"."form_templates";
CREATE TRIGGER "form_templates_outcome_form_type_check_trigger"
    BEFORE INSERT OR UPDATE OF "outcome", "form_type" ON "public"."form_templates"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."form_templates_outcome_form_type_check"();

-- ============================================================================
-- STEP 3 — form_questions.form_template_id FK with ON DELETE CASCADE (T-B3)
-- RETAIN UNIQUE(workspace_id, question_text) this Task — do NOT drop workspace_id.
-- form_questions.workspace_id FK is already ON DELETE CASCADE (squash baseline); no change needed.
-- ============================================================================
ALTER TABLE "public"."form_questions"
    ADD COLUMN IF NOT EXISTS "form_template_id" "uuid";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "information_schema"."table_constraints"
        WHERE "constraint_name" = 'form_questions_form_template_id_fkey'
          AND "table_schema" = 'public'
          AND "table_name" = 'form_questions'
    ) THEN
        ALTER TABLE "public"."form_questions"
            ADD CONSTRAINT "form_questions_form_template_id_fkey"
            FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE CASCADE;
    END IF;
END $$;

COMMENT ON COLUMN "public"."form_questions"."form_template_id" IS 'FK to the owning form (form_templates.id), ON DELETE CASCADE. ID-130 T-B3. Additive this Task — workspace_id retained; questions re-keyed in {130.8}.';

-- ============================================================================
-- STEP 4 — procurement_workspaces rollup columns (T-B21)
-- Rollup cache populated by the recompute fn/trigger in {130.6} — additive cols only here.
-- ============================================================================
ALTER TABLE "public"."procurement_workspaces"
    ADD COLUMN IF NOT EXISTS "nearest_deadline" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "overall_outcome" "text",
    ADD COLUMN IF NOT EXISTS "counts_toward_win_rate" boolean,
    ADD COLUMN IF NOT EXISTS "rollup_updated_at" timestamp with time zone;

COMMENT ON COLUMN "public"."procurement_workspaces"."nearest_deadline" IS 'Rollup cache: earliest deadline across the engagement''s forms. Populated by the recompute trigger ({130.6}). ID-130 T-B21.';
COMMENT ON COLUMN "public"."procurement_workspaces"."overall_outcome" IS 'Rollup cache: derived engagement-level outcome across its forms. Populated by the recompute trigger ({130.6}). ID-130 T-B21.';
COMMENT ON COLUMN "public"."procurement_workspaces"."counts_toward_win_rate" IS 'Rollup cache: whether this engagement contributes to win-rate. Populated by the recompute trigger ({130.6}). ID-130 T-B21.';
COMMENT ON COLUMN "public"."procurement_workspaces"."rollup_updated_at" IS 'Rollup cache: when the rollup columns were last recomputed ({130.6}). ID-130 T-B21.';

-- ============================================================================
-- STEP 5 — q_a_pairs.source_form_template_id provenance FK (T-B23)
-- ============================================================================
ALTER TABLE "public"."q_a_pairs"
    ADD COLUMN IF NOT EXISTS "source_form_template_id" "uuid";

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "information_schema"."table_constraints"
        WHERE "constraint_name" = 'q_a_pairs_source_form_template_id_fkey'
          AND "table_schema" = 'public'
          AND "table_name" = 'q_a_pairs'
    ) THEN
        ALTER TABLE "public"."q_a_pairs"
            ADD CONSTRAINT "q_a_pairs_source_form_template_id_fkey"
            FOREIGN KEY ("source_form_template_id") REFERENCES "public"."form_templates"("id");
    END IF;
END $$;

COMMENT ON COLUMN "public"."q_a_pairs"."source_form_template_id" IS 'Provenance: the form (form_templates.id) this Q&A pair was sourced from. NULLable. ID-130 T-B23.';

-- ============================================================================
-- STEP 6 — form_types pqq -> psq re-key (AD-4)
-- 0 form rows reference the pqq key (FK-safe). Idempotent: no-ops if pqq absent / psq present.
-- ============================================================================
UPDATE "public"."form_types"
SET "key" = 'psq',
    "label" = 'Selection Questionnaire (SQ/PSQ)'
WHERE "key" = 'pqq';
