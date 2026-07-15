-- ID-145 {145.6} W1c — core rename/reshape (TECH.md §2 M3; PRODUCT.md BI-1/2/6/27/28).
-- MUST land after W1a (lineage) and W1b (NULL-ftid purge) in the same batch — the
-- SET NOT NULL below requires the purge, and the source_form_template_id rename
-- below requires the lineage fix to have already run against the pre-rename column
-- names. api-view regen (W1d) and the workspace-stratum drop (W1e) are separate,
-- LATER files in this same push (W1e depends on the CASCADE severed here — see
-- that file's header). Idempotent guards (IF EXISTS / IF NOT EXISTS) are used
-- throughout so a partial-retry re-apply does not error on already-applied steps.

-- ============================================================================
-- STEP 0 — pre-drop the legacy api.* views that DEPEND on columns this file
-- DROPs (Postgres blocks DROP COLUMN under a dependent view — first observed
-- live on the S474 staging push: `api.form_templates depends on column
-- workspace_id`, SQLSTATE 2BP01). Every view dropped here is recreated against
-- the post-rename shape by W1d (20260712063000) later in this same push batch,
-- so the api surface for these four tables is absent only within the batch
-- window. Only the four column-DROP-affected views are dropped — views over
-- tables that are merely RENAMEd follow the rename and are left for W1d's own
-- DROP-and-recreate.
-- ============================================================================
DROP VIEW IF EXISTS api.form_templates;          -- blocks form_instances.workspace_id DROP (STEP 1)
DROP VIEW IF EXISTS api.form_questions;          -- blocks form_questions.workspace_id + matched_record_ids DROPs (STEP 4)
DROP VIEW IF EXISTS api.q_a_pairs;               -- blocks q_a_pairs.source_workspace_id DROP (STEP 5)
DROP VIEW IF EXISTS api.q_a_pair_dedup_proposals; -- blocks pair_a/b_source_workspace_id DROPs (STEP 5)

-- ============================================================================
-- STEP 1 — form_templates -> form_instances (BI-1: the item IS the form; no
-- second workspace-mediated home for its lifecycle facts).
-- ============================================================================
ALTER TABLE "public"."form_templates" RENAME TO "form_instances";

-- The old workspace-join SELECT policy is retired now that workspace_id is
-- dropped below — a form's readability is no longer gated through a workspace
-- EXISTS check (BI-1: the form owns its lifecycle directly, no workspace
-- mediation). DROP it explicitly BEFORE the DROP COLUMN: workspace_id is
-- referenced in this policy's USING clause, so DROP COLUMN would otherwise
-- require CASCADE and silently take the policy with it with no replacement.
DROP POLICY IF EXISTS "form_templates_select" ON "public"."form_instances";

ALTER TABLE "public"."form_instances"
    DROP COLUMN IF EXISTS "workspace_id";

-- Replacement SELECT policy: form_instances has no workspace-scoping concept
-- post-rename, so there is nothing left to EXISTS-check against. Matches the
-- house "any authenticated member may read" pattern already used by sibling
-- non-tenant-scoped tables (e.g. "Authenticated users can view source
-- documents", "Authenticated users can view citations" — both
-- `TO authenticated USING (true)`). This is the "SELECT for member roles" shape
-- TECH.md §2 M3 describes when it says the new engagement_groups table (STEP 6
-- below) mirrors form_instances' policies — role-specific gating stays on
-- INSERT/UPDATE/DELETE via the untouched templates_insert/update/delete
-- policies below (still attached post-rename, same names, unchanged bodies).
CREATE POLICY "form_instances_select" ON "public"."form_instances" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."form_instances" RENAME COLUMN "status" TO "processing_status";
COMMENT ON COLUMN "public"."form_instances"."processing_status" IS 'Document-processing pipeline axis (uploaded -> analysing -> analysed -> filling -> completed / *_failed). Orthogonal to workflow_state (the 10-state procurement axis) — ID-145 BI-1/BI-6 two-axis split, never collapsed into one "status".';

ALTER TABLE "public"."form_instances"
    ADD COLUMN IF NOT EXISTS "reference_number" "text",
    ADD COLUMN IF NOT EXISTS "estimated_value" numeric,
    ADD COLUMN IF NOT EXISTS "engagement_group_id" "uuid";

COMMENT ON COLUMN "public"."form_instances"."reference_number" IS 'First-class form attribute (ID-145 BI-5): the buyer/procurement reference number.';
COMMENT ON COLUMN "public"."form_instances"."estimated_value" IS 'First-class form attribute (ID-145 BI-5): the estimated contract value.';
-- engagement_group_id FK is added in STEP 6 below, AFTER engagement_groups exists.

-- ingest_source re-cut: {pipeline, app_upload} -> {app_upload, minted}. The
-- 'pipeline' value predates the form-first model's minted-without-a-document path
-- (manual-create-then-upload, BI-16); 'minted' replaces it. mime_type's CHECK is
-- DELIBERATELY UNCHANGED — it is already the 3-valued {docx,xlsx,pdf} set TECH.md
-- §2 M3 specifies; .doc/.xls convert to one of those three pre-insert, so the
-- constraint never needs to see the legacy MIME types.
ALTER TABLE "public"."form_instances" DROP CONSTRAINT IF EXISTS "form_templates_ingest_source_check";
-- Data migration for the re-cut (S474: the ADD CONSTRAINT below 23514'd on live
-- staging rows — every pre-existing row carries the retired 'pipeline' value).
-- All 'pipeline' rows are document-backed (storage_path present), so they map to
-- 'app_upload'; 'minted' is reserved for the created-WITHOUT-a-document path
-- (BI-16) that no historical row can have taken.
UPDATE "public"."form_instances"
    SET "ingest_source" = 'app_upload'
    WHERE "ingest_source" = 'pipeline';
ALTER TABLE "public"."form_instances"
    ADD CONSTRAINT "form_instances_ingest_source_check"
    CHECK (("ingest_source" = ANY (ARRAY['app_upload'::"text", 'minted'::"text"])));

-- ============================================================================
-- STEP 2 — form_template_fields -> form_instance_fields (Plane 2, TECH.md §3).
-- Slot model (coords, mapping_status, fill_status) unchanged. ADDS the FK that
-- never existed (C6) — form_template_fields had zero referential integrity back
-- to its owning form before this.
-- ============================================================================
ALTER TABLE "public"."form_template_fields" RENAME TO "form_instance_fields";
ALTER TABLE "public"."form_instance_fields" RENAME COLUMN "template_id" TO "form_instance_id";

ALTER TABLE "public"."form_instance_fields"
    ADD CONSTRAINT "form_instance_fields_form_instance_id_fkey"
    FOREIGN KEY ("form_instance_id") REFERENCES "public"."form_instances"("id") ON DELETE CASCADE;

-- FK covering index (unindexed_foreign_keys advisor convention, per
-- 20260619120100_index_unindexed_fks.sql) — this FK is ON DELETE CASCADE, so the
-- index also accelerates cascade deletes. The pre-existing
-- idx_form_template_fields_template index (on the old template_id column name)
-- keeps working post-RENAME COLUMN (indexes follow column renames automatically)
-- but its NAME is now stale; a fresh, correctly-named index is added rather than
-- renaming the old one, since the old one is btree(template_id, mapping_status)
-- composite (idx_form_template_fields_mapping) plus a single-column one
-- (idx_form_template_fields_template) — only the single-column one is superseded.
CREATE INDEX IF NOT EXISTS "idx_form_instance_fields_form_instance_id" ON "public"."form_instance_fields" USING "btree" ("form_instance_id");

-- ============================================================================
-- STEP 3 — form_template_requirements -> form_requirement_templates (pure
-- rename; requirement_embedding already migrated to record_embeddings, DR-036,
-- landed 20260707200000 — no column work here).
-- ============================================================================
ALTER TABLE "public"."form_template_requirements" RENAME TO "form_requirement_templates";

-- ============================================================================
-- STEP 4 — form_questions re-scope (BI-7: every question belongs to exactly one
-- form, by construction — the workspace-keyed, form-nullable anchoring that
-- produced the "Questions N + No forms yet" defect is retired).
-- ============================================================================
ALTER TABLE "public"."form_questions"
    DROP COLUMN IF EXISTS "workspace_id";
-- DROP COLUMN takes the solely-dependent form_questions_workspace_id_fkey FK,
-- the form_questions_workspace_question_unique UNIQUE constraint, and the
-- idx_form_questions_workspace index with it — none survive independently of
-- this column, and form_questions_select ("USING (true)") does not reference it.

ALTER TABLE "public"."form_questions" RENAME COLUMN "form_template_id" TO "form_instance_id";
-- W1b already purged every NULL-form_template_id row, so this SET NOT NULL is
-- safe against live data.
ALTER TABLE "public"."form_questions" ALTER COLUMN "form_instance_id" SET NOT NULL;

ALTER TABLE "public"."form_questions"
    ADD CONSTRAINT "form_questions_form_instance_question_unique" UNIQUE ("form_instance_id", "question_text");

ALTER TABLE "public"."form_questions"
    DROP COLUMN IF EXISTS "matched_record_ids";

-- ============================================================================
-- STEP 5 — template_completions, q_a_pairs, q_a_pair_dedup_proposals re-key.
-- ============================================================================
ALTER TABLE "public"."template_completions" RENAME COLUMN "template_id" TO "form_instance_id";

ALTER TABLE "public"."q_a_pairs" RENAME COLUMN "source_form_template_id" TO "source_form_instance_id";
ALTER TABLE "public"."q_a_pairs"
    DROP COLUMN IF EXISTS "source_workspace_id";
-- (W1a already migrated every resolvable row's lineage onto
-- source_form_template_id / now source_form_instance_id before this drop.)

ALTER TABLE "public"."q_a_pair_dedup_proposals"
    DROP COLUMN IF EXISTS "pair_a_source_workspace_id",
    DROP COLUMN IF EXISTS "pair_b_source_workspace_id";

-- citations: fix the stale table COMMENT — drop the content_item cited-kind
-- advert (the content_item citing branch was removed at {131.19} M6). The
-- cited_target_kind enum VALUE 'content_item' itself is NOT dropped (Postgres
-- enum values are not cheaply removable, and this is out of scope here) — this
-- is a documentation fix only, not a type change.
COMMENT ON TABLE "public"."citations" IS 'ID-58 polymorphic citations: replaces content_citations. cited side = q_a_pair (DORMANT v1, bl-74) | reference_item | source_document | concept (cited_target_kind); citing side = form_response. Version-on-cite + span anchoring (D-S330-1). ID-145 {145.6}: dropped the content_item cited-kind advert from this comment — the content_item citing branch was removed at {131.19} M6; the enum value survives for type-compat only and is no longer a live citing target.';

-- ============================================================================
-- STEP 6 — engagement_groups (R2/BI-27/BI-28): a LINK, no state, no data
-- scoping. Created here so STEP 1's engagement_group_id FK (added below) has a
-- target.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "public"."engagement_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    CONSTRAINT "engagement_groups_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."engagement_groups" OWNER TO "postgres";

COMMENT ON TABLE "public"."engagement_groups" IS 'ID-145 {145.6} R2/BI-27/BI-28 — optional, nullable link grouping sibling forms for one opportunity (e.g. a PSQ, its ITT, and the resulting tender). A LINK, never a container: does not own its forms, does not scope their data, is not a page an item lives "inside". A form belongs to at most one group; an ungrouped form is fully functional.';

ALTER TABLE "public"."engagement_groups"
    ADD CONSTRAINT "engagement_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id");

CREATE OR REPLACE TRIGGER "set_engagement_groups_updated_at" BEFORE UPDATE ON "public"."engagement_groups" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- RLS: mirrors form_instances' policies (SELECT for member roles; INSERT/UPDATE/
-- DELETE admin/editor) per TECH.md §2 M3 — explicitly "no anon grants" (unlike
-- most sibling tables' blanket GRANT ALL ... TO anon capped by RLS, this table
-- gets NO anon table-level grant at all, a stricter posture called out by name).
ALTER TABLE "public"."engagement_groups" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engagement_groups_select" ON "public"."engagement_groups" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "engagement_groups_insert" ON "public"."engagement_groups" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "engagement_groups_update" ON "public"."engagement_groups" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "engagement_groups_delete" ON "public"."engagement_groups" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

GRANT ALL ON TABLE "public"."engagement_groups" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_groups" TO "service_role";

-- Now the FK from STEP 1's engagement_group_id column can be added.
ALTER TABLE "public"."form_instances"
    ADD CONSTRAINT "form_instances_engagement_group_id_fkey"
    FOREIGN KEY ("engagement_group_id") REFERENCES "public"."engagement_groups"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_form_instances_engagement_group_id" ON "public"."form_instances" USING "btree" ("engagement_group_id");

-- ============================================================================
-- STEP 7 — processing_queue: extend job_type with analyse_form (the
-- enqueue-on-upload lane, TECH.md §3.1).
-- ============================================================================
ALTER TABLE "public"."processing_queue" DROP CONSTRAINT IF EXISTS "processing_queue_job_type_check";
ALTER TABLE "public"."processing_queue"
    ADD CONSTRAINT "processing_queue_job_type_check"
    CHECK (("job_type" = ANY (ARRAY['embed'::"text", 'classify'::"text", 'extract_qa'::"text", 'summarise'::"text", 'validate'::"text", 'reprocess'::"text", 'template_fill'::"text", 'template_analyse'::"text", 'bid_draft_all'::"text", 'form_draft_all'::"text", 'batch_reclassify'::"text", 'markdown_batch'::"text", 'analyse_form'::"text"])));

-- ============================================================================
-- STEP 8 — DROP the C3 repair stack (obsolete now form_questions.form_instance_id
-- is NOT NULL and question creation is form-first, {145.8}). ATOMIC-RELEASE
-- CONSTRAINT (TECH.md §2 M3, §10): the sole live TS caller of the RPC dropped
-- here (resolveOrMintFormTemplateId, lib/domains/procurement/
-- resolve-form-template.ts:93) is removed in the SAME merged tree by {145.7} —
-- this migration and that caller-removal ship as one atomic PR/deploy, guarded
-- by {145.7}'s grep-gate.
-- ============================================================================
DROP TRIGGER IF EXISTS "form_questions_resolve_form_template_id_trigger" ON "public"."form_questions";
DROP FUNCTION IF EXISTS "public"."form_questions_resolve_form_template_id"();
DROP FUNCTION IF EXISTS "api"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid");
DROP FUNCTION IF EXISTS "public"."resolve_or_mint_form_template_id"("uuid", "text", "text", "text", integer, "text", "uuid");

-- ============================================================================
-- STEP 9 — fix the two get_form_question_stats* function BODIES (forced by
-- STEP 4's form_questions.workspace_id drop, not a signature change). Both are
-- LANGUAGE sql functions whose body does `WHERE workspace_id = ...` /
-- `WHERE bq.workspace_id = ANY(...)` — Postgres does not track a column-level
-- dependency on a SQL-function body the way it does for a view, so STEP 4's
-- DROP COLUMN would NOT have failed or warned; it would have left these two
-- functions silently throwing 42703 (undefined column) on next call.
-- get_form_question_stats is called directly by {145.7}'s reworked
-- GET /api/procurement/[id]/questions (route.ts) — this fix is required for
-- that route to actually work post-migration, not optional cleanup.
-- CREATE OR REPLACE (not DROP+CREATE) preserves the existing ACL and the
-- api.* wrapper's signature stays valid (same name/arg types/return type;
-- DR-030/032 regen is not needed for a body-only change) — no M4 work.
-- Parameter names (p_project_id / p_project_ids) are preserved for caller
-- signature stability, matching this function's own established convention
-- (see its pre-existing COMMENT). get_form_question_stats_batch is not called
-- by any {145.6}/{145.7} file but shares the identical bug — fixed alongside
-- its sibling for internal consistency; its RETURN column stays aliased
-- `workspace_id` (its output CONTRACT is unchanged, only the internal WHERE
-- clause now reads form_instance_id) since that function's own callers are
-- outside this Subtask's file-ownership boundary.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") RETURNS TABLE("total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT AS complete_count
  FROM form_questions
  WHERE form_instance_id = p_project_id;
$$;

COMMENT ON FUNCTION "public"."get_form_question_stats"("p_project_id" "uuid") IS 'ID-145 {145.6} — body re-pointed from the dropped form_questions.workspace_id to form_instance_id (form-first re-architecture, BI-1). Parameter name p_project_id preserved for caller signature stability (T2/ID-84.1 carve-out precedent).';

CREATE OR REPLACE FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) RETURNS TABLE("workspace_id" "uuid", "total_questions" bigint, "strong_match_count" bigint, "partial_match_count" bigint, "needs_sme_count" bigint, "no_content_count" bigint, "unmatched_count" bigint, "drafted_count" bigint, "complete_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    bq.form_instance_id AS workspace_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT     AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT    AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT           AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT                AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT                  AS complete_count
  FROM form_questions bq
  WHERE bq.form_instance_id = ANY(p_project_ids)
  GROUP BY bq.form_instance_id;
$$;

COMMENT ON FUNCTION "public"."get_form_question_stats_batch"("p_project_ids" "uuid"[]) IS 'ID-145 {145.6} — body re-pointed from the dropped form_questions.workspace_id to form_instance_id (form-first re-architecture, BI-1). Output column stays aliased workspace_id — this function''s own callers are outside {145.6}/{145.7}''s file-ownership boundary, so only the internal WHERE/GROUP BY column changed, not the return contract. Parameter name p_project_ids preserved for caller signature stability.';
