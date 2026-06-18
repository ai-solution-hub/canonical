-- =============================================================================
-- PLATFORM CONTROL-PLANE CANONICAL SOURCE SCHEMA
-- =============================================================================
-- Target DB:   zjqbrdctesqvouboziae  (platform control-plane SOURCE database)
-- Scope:        ID-95 {95.12} — Option B (targeted 7-table schema, NOT a full
--               canonical `supabase db push`).
--
-- APPLY DISCIPLINE (HARD RULES):
--   * This file MUST NOT live under supabase/migrations/. It is deliberately
--     placed under supabase/platform/ so that a Knowledge Hub
--     `supabase db push` (staging/prod) NEVER applies it.
--   * Apply OUT-OF-BAND to the platform DSN ONLY, via psql:
--         psql "<platform-dsn>" -f supabase/platform/001_canonical_source_tables.sql
--   * NEVER `supabase db push` to the platform DB (that replays the full KH
--     migration history — the exact over-provisioning this file avoids).
--   * NEVER apply this DDL via MCP (apply_migration / execute_sql).
--
-- CONTENT:
--   Schema-only DDL for EXACTLY the 7 canonical SOURCE tables (FK-dependency
--   order): taxonomy_domains -> taxonomy_subtopics -> layer_vocabulary ->
--   application_types -> form_types -> form_template_requirements ->
--   reference_items. Includes PK / UNIQUE / CHECK constraints, indexes, and the
--   INTRA-set foreign keys only. No data. No RLS policies. No triggers.
--   Idempotent / re-runnable (IF NOT EXISTS guards throughout).
--
--   BASELINE DATA SEED IS DEFERRED — Liam-supervised source-row selection is a
--   separate, later step. This file creates empty tables only.
--
-- DERIVATION:
--   Faithful current-shape DDL extracted from the LIVE staging schema
--   (the staging branch) via `supabase db dump --linked --schema public`,
--   cross-checked against the defining migrations:
--     - taxonomy_domains / taxonomy_subtopics / layer_vocabulary:
--         20260416102457_pre_squash_reconciliation.sql
--     - application_types / form_types / form_template_requirements:
--         20260520120828_t2_combined_pr_intel_shape_b_form_type_split.sql
--     - reference_items:
--         20260606121451_id75_reference_items_layer.sql
--   No shape discrepancy found between the live schema and the migration files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Prerequisites
-- -----------------------------------------------------------------------------
-- `reference_items.embedding` and `form_template_requirements.requirement_embedding`
-- are pgvector columns. On managed Supabase the `vector` type lives in the
-- `extensions` schema; ensure it exists on fresh platform infra. Guarded so the
-- file stays re-runnable and tolerant of pre-provisioned extensions.
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

-- =============================================================================
-- 1. taxonomy_domains  (root of the taxonomy FK chain)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."taxonomy_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "colour" "text",
    "is_active" boolean DEFAULT true,
    "provenance" "text" NOT NULL,
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" character varying(100),
    "key_signal" "text",
    CONSTRAINT "taxonomy_domains_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taxonomy_domains_name_key" UNIQUE ("name")
);

-- =============================================================================
-- 2. taxonomy_subtopics  (FK domain_id -> taxonomy_domains.id; INTRA-set, KEPT)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."taxonomy_subtopics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true,
    "provenance" "text" NOT NULL,
    "recommended_by" "text",
    "recommended_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" character varying(100),
    CONSTRAINT "taxonomy_subtopics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "taxonomy_subtopics_domain_id_name_key" UNIQUE ("domain_id", "name")
);

-- INTRA-set FK (within the 7) — KEPT. Guarded for idempotency.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'taxonomy_subtopics_domain_id_fkey'
          AND "conrelid" = '"public"."taxonomy_subtopics"'::"regclass"
    ) THEN
        ALTER TABLE ONLY "public"."taxonomy_subtopics"
            ADD CONSTRAINT "taxonomy_subtopics_domain_id_fkey"
            FOREIGN KEY ("domain_id")
            REFERENCES "public"."taxonomy_domains"("id") ON DELETE CASCADE;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "idx_taxonomy_subtopics_domain"
    ON "public"."taxonomy_subtopics" USING "btree" ("domain_id");

-- =============================================================================
-- 3. layer_vocabulary
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."layer_vocabulary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(50) NOT NULL,
    "label" character varying(100) NOT NULL,
    "description" "text",
    "display_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone,
    CONSTRAINT "layer_vocabulary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "layer_vocabulary_key_key" UNIQUE ("key")
);

CREATE INDEX IF NOT EXISTS "idx_layer_vocabulary_active_order"
    ON "public"."layer_vocabulary" USING "btree" ("display_order")
    WHERE ("is_active" = true);

-- =============================================================================
-- 4. application_types
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."application_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "default_icon" "text",
    "default_colour" "text",
    "state_machine_config" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "label_plural" "text",
    "description" "text",
    CONSTRAINT "application_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_types_key_key" UNIQUE ("key"),
    CONSTRAINT "application_types_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);

-- =============================================================================
-- 5. form_types  (text PK on `key`; referenced by form_template_requirements)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."form_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "provenance" "text" DEFAULT 'core'::"text" NOT NULL,
    "applicable_application_types" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "form_types_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "form_types_provenance_check" CHECK (("provenance" = ANY (ARRAY['core'::"text", 'client'::"text", 'recommended'::"text"])))
);

-- =============================================================================
-- 6. form_template_requirements
--    (FK template_type -> form_types.key, text key; INTRA-set, KEPT)
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."form_template_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_name" "text" NOT NULL,
    "template_version" "text",
    "template_type" "text" NOT NULL,
    "section_ref" "text" NOT NULL,
    "section_name" "text" NOT NULL,
    "question_number" integer,
    "requirement_text" "text" NOT NULL,
    "description" "text",
    "requirement_type" "text" NOT NULL,
    "primary_domain" character varying,
    "primary_subtopic" character varying,
    "secondary_domain" character varying,
    "secondary_subtopic" character varying,
    "matching_keywords" "text"[],
    "matching_guidance" "text",
    "requirement_embedding" "extensions"."vector"(1024),
    "is_mandatory" boolean DEFAULT true,
    "is_current" boolean DEFAULT true,
    "sector_applicability" "text"[],
    "word_limit_guidance" integer,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "form_template_requirements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "form_template_requirements_unique_section" UNIQUE ("template_name", "template_version", "section_ref", "question_number"),
    CONSTRAINT "form_template_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['policy'::"text", 'statement'::"text", 'evidence'::"text", 'data'::"text", 'narrative'::"text", 'declaration'::"text", 'reference'::"text"])))
);

-- INTRA-set FK (within the 7) — KEPT. Guarded for idempotency.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint"
        WHERE "conname" = 'form_template_requirements_template_type_fkey'
          AND "conrelid" = '"public"."form_template_requirements"'::"regclass"
    ) THEN
        ALTER TABLE ONLY "public"."form_template_requirements"
            ADD CONSTRAINT "form_template_requirements_template_type_fkey"
            FOREIGN KEY ("template_type")
            REFERENCES "public"."form_types"("key") ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_current"
    ON "public"."form_template_requirements" USING "btree" ("template_name", "is_current")
    WHERE ("is_current" = true);
CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_display_order"
    ON "public"."form_template_requirements" USING "btree" ("display_order");
CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_domain"
    ON "public"."form_template_requirements" USING "btree" ("primary_domain", "primary_subtopic");
CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_sector"
    ON "public"."form_template_requirements" USING "gin" ("sector_applicability");
CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_template"
    ON "public"."form_template_requirements" USING "btree" ("template_name", "template_version");

-- =============================================================================
-- 7. reference_items
-- =============================================================================
-- NOTE — OMITTED cross-class FK:
--   The live `reference_items` table carries
--     source_document_id uuid NOT NULL
--       REFERENCES public.source_documents(id) ON DELETE RESTRICT
--   `source_documents` is a CLIENT-provenance table that the platform
--   propagation payload EXCLUDES and is NOT one of the 7 canonical SOURCE
--   tables. The FK constraint is therefore DELIBERATELY OMITTED here.
--   The column itself is retained (and kept NOT NULL, matching source) — the
--   source_document linkage is resolved at PROPAGATION time per the {95.13}
--   reference_items seam (open OQ). Schema-only: no rows exist yet, so the
--   NOT NULL column is not violated by this DDL.
CREATE TABLE IF NOT EXISTS "public"."reference_items" (
    "id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "summary" "text",
    "source_url" "text" NOT NULL,
    "published_at" timestamp with time zone,
    "primary_domain" "text",
    "primary_subtopic" "text",
    "layer" "text",
    "embedding" "extensions"."vector"(1024),
    "source_document_id" "uuid" NOT NULL,  -- cross-class link; FK to source_documents OMITTED (see note above)
    "ingestion_source" "text" NOT NULL,
    "op_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reference_items_source_url_key" UNIQUE ("source_url"),
    CONSTRAINT "reference_items_ingestion_source_check" CHECK (("ingestion_source" = ANY (ARRAY['rss_feed'::"text", 'url_import'::"text"])))
);

CREATE INDEX IF NOT EXISTS "idx_reference_items_embedding"
    ON "public"."reference_items" USING "hnsw" ("embedding" "extensions"."vector_cosine_ops")
    WITH ("m"='16', "ef_construction"='64');
CREATE INDEX IF NOT EXISTS "idx_reference_items_published_at"
    ON "public"."reference_items" USING "btree" ("published_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_reference_items_source_document_id"
    ON "public"."reference_items" USING "btree" ("source_document_id");

-- =============================================================================
-- END — 7 canonical SOURCE tables, schema-only, INTRA-set FKs only.
-- =============================================================================
