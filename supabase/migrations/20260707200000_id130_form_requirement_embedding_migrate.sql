-- ID-130 {130.24} — form_template_requirements.requirement_embedding migrates
-- into the polymorphic record_embeddings store (DR-036).
--
-- Provenance: escalated at {131.19} M6 GO-PREP inside
-- 20260706120000_id131_drop_inline_vector_cols.sql (that migration's DO-NOT-
-- APPLY-wrapped DROP statement for this exact column — kept there as
-- historical record only, NOT re-used here; this migration ships the DROP
-- fresh). record_embeddings_owner_kind_chk had NO 'form_template_requirement'
-- value at that time, so there was no store this column could migrate to; the
-- column was ACTIVELY read AND written directly by the catalogue pipeline.
-- Owner-ruled S450: MIGRATE (mirrors the company_profile T4-OQ-1 precedent —
-- 20260703140000_id131_company_embedding_migrate.sql), not "strike
-- permanently out of EMB-STORE scope".
--
-- Pattern precedent (owner_kind extension + backfill + re-point + drop):
--   company_profile — 20260703140000_id131_company_embedding_migrate.sql
--   (ALTER CHECK + backfill) followed by
--   20260706120000_id131_drop_inline_vector_cols.sql (fresh DROP, applied).
-- Companion api-view regen ships in the SAME file (DR-032 — precedent
-- 20260704130000_id131_verification_history_reparent.sql "api regen,
-- companion, same file"): api.form_template_requirements is an explicit-col
-- security_invoker view (scripts/generate-api-views.ts SURFACE_TABLES) that
-- projects requirement_embedding — dropping the base column without
-- rebuilding the view leaves a dangling column reference, and (per the M6
-- precedent) DROP COLUMN itself 2BP01s against a still-projecting view, so
-- the view is dropped BEFORE the ALTER and rebuilt (without the column)
-- AFTER it, in the same statement batch.
--
-- Data-safe / re-runnable: §1 uses DROP CONSTRAINT IF EXISTS + a superset
-- CHECK (widens the allowed set, never narrows); §2 is an idempotent
-- INSERT ... SELECT guarded by ON CONFLICT DO NOTHING on the M1b UNIQUE
-- (owner_kind, owner_id, model). requirement_embedding and
-- record_embeddings.embedding are BOTH extensions.vector(1024) — no cast
-- needed (contrast company_profiles.company_embedding, which was TEXT and
-- needed a ::extensions.vector cast).
--
-- Re-pointed in the SAME Subtask (companion TS commit, not in this
-- migration): lib/domains/procurement/form-templating/template-coverage.ts
-- (fetchTemplateRequirements), lib/domains/procurement/form-templating/
-- catalogue/from-instance.ts (resolveRequirementEmbedding,
-- confirmAndWriteCatalogue), scripts/catalogue-standard-sq.ts,
-- scripts/calibrate-coverage-thresholds.ts.
--
-- UK English throughout (DD/MM/YYYY). Authored 07/07/2026.

-- ============================================================================
-- 1. record_embeddings_owner_kind_chk — add 'form_template_requirement'.
-- Superset widen only — every previously-valid owner_kind value is preserved
-- (source_document, content_chunk, q_a_pair, reference_item, concept,
-- company_profile — the last added by the company_profile MIGRATE precedent).
-- ============================================================================
ALTER TABLE "public"."record_embeddings" DROP CONSTRAINT IF EXISTS "record_embeddings_owner_kind_chk";
ALTER TABLE "public"."record_embeddings" ADD CONSTRAINT "record_embeddings_owner_kind_chk"
    CHECK (("owner_kind" = ANY (ARRAY[
        'source_document'::"text",
        'content_chunk'::"text",
        'q_a_pair'::"text",
        'reference_item'::"text",
        'concept'::"text",
        'company_profile'::"text",
        'form_template_requirement'::"text"
    ])));

-- ============================================================================
-- 2. Normalise form_template_requirements.requirement_embedding into
-- record_embeddings. model = 'text-embedding-3-large' — the same literal the
-- catalogue pipeline's EMBEDDING_MODEL constant already uses
-- (lib/domains/procurement/form-templating/catalogue/from-instance.ts,
-- scripts/catalogue-standard-sq.ts) and matches every other record_embeddings
-- writer/reader in this store (company_profile, q_a_pair, reference_item,
-- content_chunk).
--
-- No id/created_at/updated_at supplied: all three have column defaults
-- (gen_random_uuid()/now()/now() — M1b DDL), matching the INSERT shape
-- record_embeddings readers/writers already use elsewhere.
-- ============================================================================
INSERT INTO "public"."record_embeddings" ("owner_kind", "owner_id", "model", "embedding")
SELECT
    'form_template_requirement',
    "id",
    'text-embedding-3-large',
    "requirement_embedding"
FROM "public"."form_template_requirements"
WHERE "requirement_embedding" IS NOT NULL
ON CONFLICT ("owner_kind", "owner_id", "model") DO NOTHING;

-- ============================================================================
-- 3. api regen (companion, same file — DR-032). Drop the projecting view
-- BEFORE the base-column DROP (2BP01 precedent — a projecting view blocks
-- DROP COLUMN), rebuild it after without requirement_embedding. Column list
-- and grants are otherwise IDENTICAL to the last regen
-- (20260706150000_id131_api_views_regen2.sql) — only requirement_embedding is
-- removed.
-- ============================================================================
DROP VIEW IF EXISTS api.form_template_requirements;

-- ============================================================================
-- 4. Drop the now-superseded inline vector column. Fresh DROP (the
-- DO-NOT-APPLY-wrapped statement in 20260706120000_id131_drop_inline_vector_cols.sql
-- stays as historical record only — not applied by this migration).
-- ============================================================================
ALTER TABLE "public"."form_template_requirements" DROP COLUMN IF EXISTS "requirement_embedding";

CREATE VIEW api.form_template_requirements WITH (security_invoker = true) AS
  SELECT
    id,
    template_name,
    template_version,
    template_type,
    section_ref,
    section_name,
    question_number,
    requirement_text,
    description,
    requirement_type,
    primary_domain,
    primary_subtopic,
    secondary_domain,
    secondary_subtopic,
    matching_keywords,
    matching_guidance,
    is_mandatory,
    is_current,
    sector_applicability,
    word_limit_guidance,
    display_order,
    created_at,
    updated_at
  FROM public.form_template_requirements;
GRANT SELECT ON api.form_template_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.form_template_requirements TO service_role;
