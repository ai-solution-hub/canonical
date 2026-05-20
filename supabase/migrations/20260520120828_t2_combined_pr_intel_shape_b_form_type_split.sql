-- =============================================================================
-- T2 Combined-PR Migration (WP2b — Session 246)
-- =============================================================================
--
-- Scope: PLAN.md §4.2 sub-tasks 1-9 + 5 reserved satellite seats + intelligence
-- Shape B promotion + form_type 3-tier split. Single transaction.
--
-- Sources of truth:
--   * docs/specs/canonical-pipeline-implementation-plan/PLAN.md §4.2 (sub-tasks 1-9)
--   * docs/specs/intelligence-workspaces/{PRODUCT,TECH}.md T-1..T-7
--   * docs/specs/reserved-workspace-seats/{PRODUCT,TECH}.md T-1..T-8
--   * docs/specs/rls-pattern/{PRODUCT,TECH}.md (auto-RLS trigger + grants helper)
--   * docs/plans/phase-0-investigation/architecture/04-workspace-types.md §3 + §4 + §7
--   * docs/plans/phase-0-investigation/architecture/07-collapse-list.md §3
--   * docs/ontology/26-form-type.md (3-tier split target)
--
-- Apply discipline:
--   * Staging first: supabase db push --linked turayklvaunphgbgscat
--   * Liam ratification gate, then prod: supabase db push --linked rovrymhhffssilaftdwd
--   * CLI in sandbox: dangerouslyDisableSandbox=true + POSTGRES_PASSWORD set
--   * cat supabase/.temp/project-ref before each push (CLAUDE.md project-ref drift gotcha)
--   * supabase gen types typescript after apply (regenerates database.types.ts)
--
-- Apply log:
--   * S246 (20/05/2026) staging-apply: commit `38242fef` — clean (greenfield 0/0/0/0).
--   * S247 (20/05/2026) prod-apply: commit `2f98c8cf` — added sub-task 1.5b
--     sync_bid_status trigger drop after first attempt failed (NEW.type
--     dereference post-column-drop). Clean re-apply: 4/3/2/0 + 96/96 + 24/24 +
--     6/6/8/3. Documented in SCHEMA-QUICK-REFERENCE.md §33.
--
-- Env-agnostic assertion design (Liam ratification S246 W1):
--   Sub-task 8 (intelligence_workspaces backfill) captures pre-state counts INTO
--   PL/pgSQL vars, runs the INSERT, then asserts post-state matches captured
--   pre-state. Works against prod (4/3/2/0 expected) AND staging (0/0/0/0 if
--   staging was not refreshed) without env-specific SQL.
--
-- Live state snapshot (audited 20/05/2026 via mcp__supabase__execute_sql):
--   * Prod: 4 intel workspaces (3 with company_profile_id, 2 with guide_id, 0 with
--     relevance_threshold); 0 bid workspaces; 0 kb_section workspaces.
--   * Staging: 1 bid workspace; 0 intel; rest greenfield.
--   * `bid_workspaces` table does NOT exist in either env — procurement seat is
--     a CREATE not a rename (Liam ratification S246 W1).
--   * `source_documents.workspace_id` is ALREADY nullable in prod — sub-task 5
--     is a no-op with audit comment.
--   * `template_requirements` has 96 rows: 66 `sq` + 30 `rfp`.
--   * `entity_aliases.category` (varchar): 10 `client` + 14 `generic`.
--
-- =============================================================================

BEGIN;

-- =============================================================================
-- SUB-TASK 1 — application_types + workspaces FK swap + procurement_workspaces
--              seat + project_id → workspace_id rename + kb_section retire
-- =============================================================================

-- 1.1 application_types instance table (Q-OQR1-01 Option (c) hybrid)
CREATE TABLE public.application_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  provenance text NOT NULL DEFAULT 'core' CHECK (provenance IN ('core', 'client', 'recommended')),
  default_icon text NULL,
  default_colour text NULL,
  state_machine_config jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS auto-enabled by ensure_rls event trigger; explicit ALTER belt-and-braces
ALTER TABLE public.application_types ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.application_types'::regclass);

-- application_types is platform-wide reference data: everyone SELECTs the
-- closed-list rows; only service_role mutates (admin UI is DEFERRED-v1.1 per
-- Q-OQR1-13).
CREATE POLICY application_types_select_all ON public.application_types
  FOR SELECT USING (true);

-- 1.2 Seed 6 baseline `core`-provenance rows (Q-OQR1-03)
INSERT INTO public.application_types (key, label, provenance) VALUES
  ('procurement',          'Procurement',          'core'),
  ('intelligence',         'Intelligence',         'core'),
  ('sales_proposal',       'Sales Proposal',       'core'),
  ('product_guide',        'Product Guide',        'core'),
  ('competitor_research',  'Competitor Research',  'core'),
  ('training_onboarding',  'Training Onboarding',  'core');

-- 1.3 Add application_type_id FK to workspaces (nullable initially, then
--     backfilled, then NOT NULL)
ALTER TABLE public.workspaces
  ADD COLUMN application_type_id uuid NULL REFERENCES public.application_types(id);

-- 1.4 Backfill application_type_id from workspaces.type. Map:
--   * 'bid'          → 'procurement'  (Q-OQR1-02 procurement umbrella rename)
--   * 'intelligence' → 'intelligence'
--   * 'kb_section'   → (no rows — verified S234 + S246; CHECK retires below)
UPDATE public.workspaces w
SET application_type_id = at.id
FROM public.application_types at
WHERE
  (w.type = 'bid'          AND at.key = 'procurement')
  OR
  (w.type = 'intelligence' AND at.key = 'intelligence');

-- 1.5 Verify backfill: no kb_section rows, no NULL application_type_id rows
DO $$
DECLARE
  v_kb_count int;
  v_unmapped int;
BEGIN
  SELECT count(*) INTO v_kb_count
  FROM public.workspaces WHERE type = 'kb_section';
  IF v_kb_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected kb_section workspaces: % rows (expected 0 per S234 + S246 audit)', v_kb_count;
  END IF;

  SELECT count(*) INTO v_unmapped
  FROM public.workspaces WHERE application_type_id IS NULL;
  IF v_unmapped <> 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows have NULL application_type_id', v_unmapped;
  END IF;
END $$;

-- 1.5b sync_bid_status trigger retire (extracted from T4 procurement-rename scope)
--      The legacy `sync_bid_status` trigger on public.workspaces fires BEFORE
--      INSERT OR UPDATE and dereferences `NEW.type` (dropped in 1.6 below).
--      Staging-apply (S246) did not exercise this path because greenfield (0
--      intel rows w/ JSONB keys → sub-task 8.3 UPDATE matched 0 rows → trigger
--      never fired). Prod has 3 intel rows w/ those keys; without this drop,
--      sub-task 8.3 fails with `record "new" has no field "type"` (SQLSTATE 42703).
--      Code audit S247: no production path writes `workspaces.status` column for
--      bid workspaces — trigger is dead-code w.r.t. live writers. T4 was scoped to
--      retire this; pulled forward as a single transactional drop here. Idempotent
--      DROP IF EXISTS so applies cleanly to envs that already lack the trigger.
DROP TRIGGER IF EXISTS sync_bid_status ON public.workspaces;
DROP FUNCTION IF EXISTS public.sync_bid_status_to_jsonb();

-- 1.6 Drop old discriminator (CHECK constraint + text column)
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_type_check;
ALTER TABLE public.workspaces DROP COLUMN type;

-- Make application_type_id NOT NULL now that all rows are backfilled
ALTER TABLE public.workspaces ALTER COLUMN application_type_id SET NOT NULL;

-- Index for the new FK (workspace listings filter by application_type)
CREATE INDEX idx_workspaces_application_type ON public.workspaces(application_type_id);

-- 1.7 Drop stale `projects_status_check` (orphan from pre-rename "projects"
--     table; carries a status enum no longer used by workspaces — confirmed
--     S246 audit). Safe to drop: CHECK allows NULL via leading clause.
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS projects_status_check;

-- 1.8 Rename project_id → workspace_id on bid_questions + templates (Q5.5 /
--     PLAN §4.2 sub-task 1, item 5). The 44-file code sweep is T4 scope —
--     this migration covers the 2 DB columns only.
ALTER TABLE public.bid_questions RENAME COLUMN project_id TO workspace_id;
ALTER TABLE public.bid_questions
  RENAME CONSTRAINT bid_questions_project_id_fkey TO bid_questions_workspace_id_fkey;
-- RENAME CONSTRAINT auto-renames the backing unique index; do not double-rename
ALTER TABLE public.bid_questions
  RENAME CONSTRAINT bid_questions_project_question_unique TO bid_questions_workspace_question_unique;
ALTER INDEX public.idx_bid_questions_project
  RENAME TO idx_bid_questions_workspace;

ALTER TABLE public.templates RENAME COLUMN project_id TO workspace_id;
ALTER TABLE public.templates
  RENAME CONSTRAINT templates_project_id_fkey TO templates_workspace_id_fkey;
ALTER INDEX public.idx_templates_project RENAME TO idx_templates_workspace;

-- 1.9 CREATE procurement_workspaces reserved seat (Liam ratification S246 W1:
--     `bid_workspaces` never existed in prod, so this is a CREATE not a
--     rename). 6 OQ-Q38-E columns deferred to T4 procurement feature spec.
CREATE TABLE public.procurement_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.procurement_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.procurement_workspaces'::regclass);

-- RLS delegates to workspaces parent via EXISTS (per RWS T-5). workspaces' own
-- role-based RLS scopes the subquery, so this satellite inherits parent scope.
CREATE POLICY procurement_workspaces_select ON public.procurement_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = procurement_workspaces.workspace_id));
CREATE POLICY procurement_workspaces_insert ON public.procurement_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = procurement_workspaces.workspace_id));
CREATE POLICY procurement_workspaces_update ON public.procurement_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = procurement_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = procurement_workspaces.workspace_id));
CREATE POLICY procurement_workspaces_delete ON public.procurement_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = procurement_workspaces.workspace_id));

-- Backfill procurement satellite for any prod workspace that mapped from 'bid'
-- (S246 audit: 0 such rows in prod, 1 in staging — INSERT … SELECT no-ops on prod).
INSERT INTO public.procurement_workspaces (workspace_id)
SELECT w.id
FROM public.workspaces w
JOIN public.application_types at ON at.id = w.application_type_id
WHERE at.key = 'procurement';

-- =============================================================================
-- SUB-TASK 2 — templates → form_templates rename (PLAN §4.2 sub-task 2)
-- =============================================================================

ALTER TABLE public.templates              RENAME TO form_templates;
ALTER TABLE public.template_fields        RENAME TO form_template_fields;
ALTER TABLE public.template_requirements  RENAME TO form_template_requirements;

-- Rename associated constraints + indexes for clarity (table renames keep old
-- constraint/index names by default in Postgres)
ALTER TABLE public.form_templates
  RENAME CONSTRAINT templates_workspace_id_fkey TO form_templates_workspace_id_fkey;
ALTER TABLE public.form_templates
  RENAME CONSTRAINT templates_created_by_fkey TO form_templates_created_by_fkey;
ALTER TABLE public.form_templates
  RENAME CONSTRAINT templates_mime_type_check TO form_templates_mime_type_check;
ALTER TABLE public.form_templates
  RENAME CONSTRAINT templates_status_check TO form_templates_status_check;
ALTER INDEX public.templates_pkey            RENAME TO form_templates_pkey;
ALTER INDEX public.idx_templates_workspace   RENAME TO idx_form_templates_workspace;
ALTER INDEX public.idx_templates_created_by  RENAME TO idx_form_templates_created_by;
ALTER INDEX public.idx_templates_status      RENAME TO idx_form_templates_status;

ALTER TABLE public.form_template_fields
  RENAME CONSTRAINT template_fields_template_id_fkey TO form_template_fields_template_id_fkey;
ALTER TABLE public.form_template_fields
  RENAME CONSTRAINT template_fields_question_id_fkey TO form_template_fields_question_id_fkey;
ALTER TABLE public.form_template_fields
  RENAME CONSTRAINT template_fields_field_type_check TO form_template_fields_field_type_check;
ALTER TABLE public.form_template_fields
  RENAME CONSTRAINT template_fields_fill_status_check TO form_template_fields_fill_status_check;
ALTER TABLE public.form_template_fields
  RENAME CONSTRAINT template_fields_mapping_status_check TO form_template_fields_mapping_status_check;
ALTER INDEX public.template_fields_pkey         RENAME TO form_template_fields_pkey;
ALTER INDEX public.idx_template_fields_template RENAME TO idx_form_template_fields_template;
ALTER INDEX public.idx_template_fields_question RENAME TO idx_form_template_fields_question;
ALTER INDEX public.idx_template_fields_mapping  RENAME TO idx_form_template_fields_mapping;

ALTER TABLE public.form_template_requirements
  RENAME CONSTRAINT template_requirements_requirement_type_check TO form_template_requirements_requirement_type_check;
ALTER TABLE public.form_template_requirements
  RENAME CONSTRAINT template_requirements_template_type_check TO form_template_requirements_template_type_check;
-- RENAME CONSTRAINT auto-renames the backing unique index; do not double-rename
ALTER TABLE public.form_template_requirements
  RENAME CONSTRAINT template_requirements_template_name_template_version_sectio_key TO form_template_requirements_unique_section;
ALTER INDEX public.template_requirements_pkey RENAME TO form_template_requirements_pkey;
ALTER INDEX public.idx_template_reqs_template          RENAME TO idx_form_template_requirements_template;
ALTER INDEX public.idx_template_reqs_current           RENAME TO idx_form_template_requirements_current;
ALTER INDEX public.idx_template_reqs_domain            RENAME TO idx_form_template_requirements_domain;
ALTER INDEX public.idx_template_reqs_sector            RENAME TO idx_form_template_requirements_sector;
ALTER INDEX public.idx_template_requirements_display_order RENAME TO idx_form_template_requirements_display_order;

-- form_template_fields.question_id FK still references bid_questions — that
-- table is NOT renamed in this migration (Q-OQR1-02 keeps `bid_questions` per
-- §7.3 — "bid" survives as a form_type value within procurement).

-- =============================================================================
-- SUB-TASK 3 — digests → change_reports rename (PLAN §4.2 sub-task 3)
-- =============================================================================
--
-- DB rename only. Code rename (lib/digest/* → lib/change-reports/*) is T5 scope.

ALTER TABLE public.digests RENAME TO change_reports;
ALTER INDEX public.digests_pkey         RENAME TO change_reports_pkey;
ALTER INDEX public.idx_digests_created_by RENAME TO idx_change_reports_created_by;

-- Drop and recreate RLS policies (Postgres keeps old policy names; rename via
-- DROP + CREATE for clarity)
DROP POLICY IF EXISTS digests_select ON public.change_reports;
DROP POLICY IF EXISTS digests_insert ON public.change_reports;
DROP POLICY IF EXISTS digests_delete ON public.change_reports;

CREATE POLICY change_reports_select ON public.change_reports FOR SELECT USING (true);
CREATE POLICY change_reports_insert ON public.change_reports FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY change_reports_delete ON public.change_reports FOR DELETE
  USING (auth.role() IN ('authenticated', 'service_role'));

-- =============================================================================
-- SUB-TASK 4 — provenance enum + entity_aliases.category → provenance
--              (PLAN §4.2 sub-task 4 — Q-OQR1-11 hybrid-vocab retrofit)
-- =============================================================================

-- 4.1 Create canonical provenance enum (text-typed for now; future tightening
--     to PG enum type DEFERRED-v1.1 — text+CHECK is the Q-OQR1-11 ratified
--     shape). Already used as inline CHECK in application_types (sub-task 1).
--     entity_aliases retrofit uses the same value set.

-- 4.2 entity_aliases.category → provenance (column rename + value-set widening)
--     Live data: 10 'client' + 14 'generic'. New CHECK: client | core | recommended.
--     'generic' (legacy) maps to 'core' (platform-shipped baseline alias).
ALTER TABLE public.entity_aliases DROP CONSTRAINT IF EXISTS entity_aliases_category_check;

UPDATE public.entity_aliases SET category = 'core' WHERE category = 'generic';

ALTER TABLE public.entity_aliases RENAME COLUMN category TO provenance;
ALTER TABLE public.entity_aliases
  ALTER COLUMN provenance TYPE text USING provenance::text;
ALTER TABLE public.entity_aliases
  ALTER COLUMN provenance SET DEFAULT 'core';
ALTER TABLE public.entity_aliases
  ADD CONSTRAINT entity_aliases_provenance_check
  CHECK (provenance IN ('core', 'client', 'recommended'));

-- Verify retrofit: counts preserved, no NULL or unmapped values
DO $$
DECLARE
  v_total int;
  v_unmapped int;
  v_client int;
  v_core int;
BEGIN
  SELECT count(*) INTO v_total FROM public.entity_aliases;
  SELECT count(*) INTO v_unmapped
  FROM public.entity_aliases
  WHERE provenance NOT IN ('core', 'client', 'recommended') OR provenance IS NULL;
  IF v_unmapped <> 0 THEN
    RAISE EXCEPTION 'entity_aliases retrofit incomplete: % rows have unmapped provenance', v_unmapped;
  END IF;
  SELECT count(*) INTO v_client FROM public.entity_aliases WHERE provenance = 'client';
  SELECT count(*) INTO v_core   FROM public.entity_aliases WHERE provenance = 'core';
  RAISE NOTICE 'entity_aliases provenance retrofit: total=%, client=%, core=% (legacy generic mapped to core)',
    v_total, v_client, v_core;
END $$;

-- =============================================================================
-- SUB-TASK 5 — source_documents.workspace_id NULLABLE (PLAN §4.2 sub-task 5)
-- =============================================================================
--
-- NO-OP IN PROD: source_documents.workspace_id is ALREADY nullable
-- (audited 20/05/2026 via mcp__supabase__execute_sql; notnull=false). The
-- column was nullable from initial schema, NOT made nullable later — so no
-- ALTER is needed. This block is preserved as documentation only.
--
-- If a future audit surfaces this as NOT NULL on some env, the ALTER would be:
--   ALTER TABLE public.source_documents ALTER COLUMN workspace_id DROP NOT NULL;
--
-- Belt-and-braces idempotent ALTER (DROP NOT NULL is a no-op if already nullable):
ALTER TABLE public.source_documents ALTER COLUMN workspace_id DROP NOT NULL;

-- =============================================================================
-- SUB-TASK 6 — q_a_pairs schema sketch (PLAN §4.2 sub-task 6)
-- =============================================================================
--
-- Minimal shape per Q-OQR1-06 corpus-level cardinality. Full schema (alternate
-- phrasings, scope_tag GIN indexes, q_a_extractions derived cache, history
-- triggers) lands in T6 follow-on per PLAN §4.6. NO data migration from
-- content_items.content_type='q_a_pair' (superseded by T7 cocoindex first-ingest
-- per S243 ratification).

CREATE TABLE public.q_a_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text text NOT NULL,
  answer_standard text NULL,
  answer_advanced text NULL,
  scope_tag text[] NOT NULL DEFAULT ARRAY[]::text[],
  anti_scope_tag text[] NOT NULL DEFAULT ARRAY[]::text[],
  source_workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE SET NULL,
  origin_kind text NOT NULL DEFAULT 'manual'
    CHECK (origin_kind IN ('manual', 'imported_legacy', 'derived_from_bid_response', 'cocoindex_extracted')),
  publication_status text NOT NULL DEFAULT 'draft'
    CHECK (publication_status IN ('draft', 'published', 'superseded', 'archived')),
  superseded_by uuid NULL REFERENCES public.q_a_pairs(id) ON DELETE SET NULL,
  valid_from timestamptz NULL,
  valid_to timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.q_a_pairs ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.q_a_pairs'::regclass);

-- Authenticated users read all q_a_pairs (corpus-level model); writes gated by
-- editor / admin roles (full role-based policies follow in T6 with rich shape)
CREATE POLICY q_a_pairs_select ON public.q_a_pairs FOR SELECT USING (true);
CREATE POLICY q_a_pairs_insert ON public.q_a_pairs FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY q_a_pairs_update ON public.q_a_pairs FOR UPDATE
  USING (auth.role() IN ('authenticated', 'service_role'));
CREATE POLICY q_a_pairs_delete ON public.q_a_pairs FOR DELETE
  USING (auth.role() IN ('authenticated', 'service_role'));

-- =============================================================================
-- SUB-TASK 7 — 5 reserved satellite seats (PLAN §4.2 sub-task 7 + RWS T-1..T-8)
-- =============================================================================
--
-- 5 reserved seats (intel + sales_proposal + product_guide + competitor_research
-- + training_onboarding). Procurement seat created in sub-task 1.9.
-- Per-app columns deferred to feature specs per RWS S-7 ALTER discipline.

-- 7.1 intelligence_workspaces — typed columns added immediately in sub-task 8
CREATE TABLE public.intelligence_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.intelligence_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.intelligence_workspaces'::regclass);

CREATE POLICY intelligence_workspaces_select ON public.intelligence_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = intelligence_workspaces.workspace_id));
CREATE POLICY intelligence_workspaces_insert ON public.intelligence_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = intelligence_workspaces.workspace_id));
CREATE POLICY intelligence_workspaces_update ON public.intelligence_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = intelligence_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = intelligence_workspaces.workspace_id));
CREATE POLICY intelligence_workspaces_delete ON public.intelligence_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = intelligence_workspaces.workspace_id));

-- 7.2 sales_proposal_workspaces
CREATE TABLE public.sales_proposal_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_proposal_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.sales_proposal_workspaces'::regclass);
CREATE POLICY sales_proposal_workspaces_select ON public.sales_proposal_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = sales_proposal_workspaces.workspace_id));
CREATE POLICY sales_proposal_workspaces_insert ON public.sales_proposal_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = sales_proposal_workspaces.workspace_id));
CREATE POLICY sales_proposal_workspaces_update ON public.sales_proposal_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = sales_proposal_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = sales_proposal_workspaces.workspace_id));
CREATE POLICY sales_proposal_workspaces_delete ON public.sales_proposal_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = sales_proposal_workspaces.workspace_id));

-- 7.3 product_guide_workspaces
CREATE TABLE public.product_guide_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_guide_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.product_guide_workspaces'::regclass);
CREATE POLICY product_guide_workspaces_select ON public.product_guide_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = product_guide_workspaces.workspace_id));
CREATE POLICY product_guide_workspaces_insert ON public.product_guide_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = product_guide_workspaces.workspace_id));
CREATE POLICY product_guide_workspaces_update ON public.product_guide_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = product_guide_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = product_guide_workspaces.workspace_id));
CREATE POLICY product_guide_workspaces_delete ON public.product_guide_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = product_guide_workspaces.workspace_id));

-- 7.4 competitor_research_workspaces
CREATE TABLE public.competitor_research_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.competitor_research_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.competitor_research_workspaces'::regclass);
CREATE POLICY competitor_research_workspaces_select ON public.competitor_research_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = competitor_research_workspaces.workspace_id));
CREATE POLICY competitor_research_workspaces_insert ON public.competitor_research_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = competitor_research_workspaces.workspace_id));
CREATE POLICY competitor_research_workspaces_update ON public.competitor_research_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = competitor_research_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = competitor_research_workspaces.workspace_id));
CREATE POLICY competitor_research_workspaces_delete ON public.competitor_research_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = competitor_research_workspaces.workspace_id));

-- 7.5 training_onboarding_workspaces
CREATE TABLE public.training_onboarding_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.training_onboarding_workspaces ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.training_onboarding_workspaces'::regclass);
CREATE POLICY training_onboarding_workspaces_select ON public.training_onboarding_workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = training_onboarding_workspaces.workspace_id));
CREATE POLICY training_onboarding_workspaces_insert ON public.training_onboarding_workspaces FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = training_onboarding_workspaces.workspace_id));
CREATE POLICY training_onboarding_workspaces_update ON public.training_onboarding_workspaces FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = training_onboarding_workspaces.workspace_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = training_onboarding_workspaces.workspace_id));
CREATE POLICY training_onboarding_workspaces_delete ON public.training_onboarding_workspaces FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = training_onboarding_workspaces.workspace_id));

-- =============================================================================
-- SUB-TASK 8 — intelligence_workspaces Shape B + backfill + JSONB strip
--              (PLAN §4.2 sub-task 8 + intel TECH T-1..T-3 + S246 W1 ratified
--              env-agnostic assertion design)
-- =============================================================================

-- 8.1 Add 3 typed columns per intel TECH T-1
ALTER TABLE public.intelligence_workspaces
  ADD COLUMN company_profile_id uuid NULL REFERENCES public.company_profiles(id) ON DELETE SET NULL,
  ADD COLUMN guide_id uuid NULL REFERENCES public.guides(id) ON DELETE SET NULL,
  ADD COLUMN relevance_threshold real NULL
    CHECK (relevance_threshold IS NULL OR (relevance_threshold >= 0.1 AND relevance_threshold <= 1.0));

-- 8.2 + 8.3 Backfill from JSONB + strip JSONB keys — env-agnostic assertion:
--           captures pre-state counts, runs INSERT + UPDATE, asserts post-state
--           matches pre-state. Works on prod (4/3/2/0) AND staging (0/0/0/0).
DO $$
DECLARE
  v_intel_type_id uuid;
  v_pre_intel int;
  v_pre_w_profile int;
  v_pre_w_guide int;
  v_pre_w_threshold int;
  v_post_intel int;
  v_post_w_profile int;
  v_post_w_guide int;
  v_post_w_threshold int;
  v_post_unstripped int;
BEGIN
  -- Resolve 'intelligence' application_type id
  SELECT id INTO v_intel_type_id
  FROM public.application_types WHERE key = 'intelligence';
  IF v_intel_type_id IS NULL THEN
    RAISE EXCEPTION 'application_types row for key=intelligence not found (seed step in sub-task 1.2 failed?)';
  END IF;

  -- Capture pre-state JSONB counts on workspaces (env-agnostic invariant source)
  SELECT
    count(*),
    count(*) FILTER (WHERE domain_metadata ? 'company_profile_id'),
    count(*) FILTER (WHERE domain_metadata ? 'guide_id'),
    count(*) FILTER (WHERE domain_metadata ? 'relevance_threshold')
  INTO v_pre_intel, v_pre_w_profile, v_pre_w_guide, v_pre_w_threshold
  FROM public.workspaces
  WHERE application_type_id = v_intel_type_id;

  RAISE NOTICE 'intel pre-backfill: total=%, with_profile=%, with_guide=%, with_threshold=%',
    v_pre_intel, v_pre_w_profile, v_pre_w_guide, v_pre_w_threshold;

  -- Backfill: one intelligence_workspaces row per intel workspace, projecting
  -- 3 typed cols from JSONB. NULL cols where JSONB key missing.
  INSERT INTO public.intelligence_workspaces (workspace_id, company_profile_id, guide_id, relevance_threshold)
  SELECT
    w.id,
    CASE
      WHEN w.domain_metadata ? 'company_profile_id'
        AND (w.domain_metadata->>'company_profile_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (w.domain_metadata->>'company_profile_id')::uuid
      ELSE NULL
    END,
    CASE
      WHEN w.domain_metadata ? 'guide_id'
        AND (w.domain_metadata->>'guide_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (w.domain_metadata->>'guide_id')::uuid
      ELSE NULL
    END,
    CASE
      WHEN w.domain_metadata ? 'relevance_threshold'
      THEN (w.domain_metadata->>'relevance_threshold')::real
      ELSE NULL
    END
  FROM public.workspaces w
  WHERE w.application_type_id = v_intel_type_id;

  -- Strip JSONB keys from workspaces.domain_metadata for intel rows
  UPDATE public.workspaces
  SET domain_metadata = (
    COALESCE(domain_metadata, '{}'::jsonb)
      - 'company_profile_id'
      - 'guide_id'
      - 'relevance_threshold'
  )
  WHERE application_type_id = v_intel_type_id
    AND (
      domain_metadata ? 'company_profile_id'
      OR domain_metadata ? 'guide_id'
      OR domain_metadata ? 'relevance_threshold'
    );

  -- Capture post-state typed-col counts
  SELECT
    count(*),
    count(*) FILTER (WHERE company_profile_id IS NOT NULL),
    count(*) FILTER (WHERE guide_id IS NOT NULL),
    count(*) FILTER (WHERE relevance_threshold IS NOT NULL)
  INTO v_post_intel, v_post_w_profile, v_post_w_guide, v_post_w_threshold
  FROM public.intelligence_workspaces;

  -- Strip-verification count
  SELECT count(*) INTO v_post_unstripped
  FROM public.workspaces
  WHERE application_type_id = v_intel_type_id
    AND (
      domain_metadata ? 'company_profile_id'
      OR domain_metadata ? 'guide_id'
      OR domain_metadata ? 'relevance_threshold'
    );

  RAISE NOTICE 'intel post-backfill: total=%, with_profile=%, with_guide=%, with_threshold=%; unstripped_intel_rows=%',
    v_post_intel, v_post_w_profile, v_post_w_guide, v_post_w_threshold, v_post_unstripped;

  -- Env-agnostic invariant: post-state matches pre-state
  IF v_post_intel       <> v_pre_intel       THEN
    RAISE EXCEPTION 'intel satellite row count mismatch: post=% != pre=%', v_post_intel, v_pre_intel;
  END IF;
  IF v_post_w_profile   <> v_pre_w_profile   THEN
    RAISE EXCEPTION 'intel company_profile_id count mismatch: post=% != pre=%', v_post_w_profile, v_pre_w_profile;
  END IF;
  IF v_post_w_guide     <> v_pre_w_guide     THEN
    RAISE EXCEPTION 'intel guide_id count mismatch: post=% != pre=%', v_post_w_guide, v_pre_w_guide;
  END IF;
  IF v_post_w_threshold <> v_pre_w_threshold THEN
    RAISE EXCEPTION 'intel relevance_threshold count mismatch: post=% != pre=%', v_post_w_threshold, v_pre_w_threshold;
  END IF;
  IF v_post_unstripped  <> 0                 THEN
    RAISE EXCEPTION 'intel JSONB strip incomplete: % rows still carry stripped keys', v_post_unstripped;
  END IF;
END $$;

-- =============================================================================
-- SUB-TASK 9 — form_type 3-tier split (PLAN §4.2 sub-task 9 + ontology §111-129)
-- =============================================================================
--
-- Three NEW CV tables: form_types (8 vals), procurement_vehicles (3 vals),
-- procurement_vehicle_instances (g_cloud + dos seed). Existing
-- form_template_requirements.template_type CHECK has 10 vals — 96 prod rows
-- (66 'sq' + 30 'rfp') need crosswalk: sq→pqq (SSQ is sub-shape of PQQ per
-- ontology §60), rfp→rfp. Other 8 vals in CHECK have 0 rows.

-- 9.1 form_types CV table (8 trimmed values per ontology §117)
CREATE TABLE public.form_types (
  key text PRIMARY KEY,
  label text NOT NULL,
  provenance text NOT NULL DEFAULT 'core' CHECK (provenance IN ('core', 'client', 'recommended')),
  applicable_application_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.form_types ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.form_types'::regclass);
CREATE POLICY form_types_select_all ON public.form_types FOR SELECT USING (true);

INSERT INTO public.form_types (key, label, provenance, applicable_application_types) VALUES
  ('bid',                     'Bid',                     'core', ARRAY['procurement']),
  ('rfp',                     'RFP (Request For Proposal)', 'core', ARRAY['procurement']),
  ('pqq',                     'PQQ (Pre-Qualification Questionnaire)', 'core', ARRAY['procurement']),
  ('itt',                     'ITT (Invitation To Tender)', 'core', ARRAY['procurement']),
  ('tender',                  'Tender',                  'core', ARRAY['procurement']),
  ('checklist',               'Checklist',               'core', ARRAY['procurement','sales_proposal','product_guide']),
  ('questionnaire',           'Questionnaire',           'core', ARRAY['procurement','competitor_research']),
  ('sales_proposal_template', 'Sales Proposal Template', 'core', ARRAY['sales_proposal']);

-- 9.2 procurement_vehicles CV table (3 vals per ontology §118)
CREATE TABLE public.procurement_vehicles (
  key text PRIMARY KEY,
  label text NOT NULL,
  provenance text NOT NULL DEFAULT 'core' CHECK (provenance IN ('core', 'client', 'recommended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.procurement_vehicles ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.procurement_vehicles'::regclass);
CREATE POLICY procurement_vehicles_select_all ON public.procurement_vehicles FOR SELECT USING (true);

INSERT INTO public.procurement_vehicles (key, label, provenance) VALUES
  ('framework',          'Framework',                    'core'),
  ('dps',                'DPS (Dynamic Purchasing System)', 'core'),
  ('dynamic_procurement','Dynamic Procurement',          'core');

-- 9.3 procurement_vehicle_instances table (instance pattern per ontology §119)
CREATE TABLE public.procurement_vehicle_instances (
  key text PRIMARY KEY,
  label text NOT NULL,
  vehicle_key text NOT NULL REFERENCES public.procurement_vehicles(key) ON DELETE RESTRICT,
  provenance text NOT NULL DEFAULT 'core' CHECK (provenance IN ('core', 'client', 'recommended')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.procurement_vehicle_instances ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.procurement_vehicle_instances'::regclass);
CREATE POLICY procurement_vehicle_instances_select_all ON public.procurement_vehicle_instances FOR SELECT USING (true);

INSERT INTO public.procurement_vehicle_instances (key, label, vehicle_key, provenance) VALUES
  ('g_cloud', 'G-Cloud',                              'framework', 'core'),
  ('dos',     'DOS (Digital Outcomes and Specialists)', 'framework', 'core');

-- 9.4 Crosswalk live form_template_requirements.template_type values to new CV.
--     Map: sq→pqq (SSQ sub-shape of PQQ per ontology §60); rfp→rfp.
--     Other 8 values in old CHECK have 0 rows in prod — drop from CHECK + map
--     defensively to nearest equivalent for any future data.

ALTER TABLE public.form_template_requirements
  DROP CONSTRAINT IF EXISTS form_template_requirements_template_type_check;

UPDATE public.form_template_requirements SET template_type = 'pqq' WHERE template_type = 'sq';

-- Replace inline CHECK with FK to form_types(key) — typed cardinality, easier
-- extension via INSERT into form_types vs ALTER + CHECK rewrite.
ALTER TABLE public.form_template_requirements
  ADD CONSTRAINT form_template_requirements_template_type_fkey
  FOREIGN KEY (template_type) REFERENCES public.form_types(key) ON DELETE RESTRICT;

-- Verify crosswalk: every row's template_type now resolves to form_types.key
DO $$
DECLARE
  v_unresolved int;
  v_total int;
BEGIN
  SELECT count(*) INTO v_total FROM public.form_template_requirements;
  SELECT count(*) INTO v_unresolved
  FROM public.form_template_requirements ftr
  LEFT JOIN public.form_types ft ON ft.key = ftr.template_type
  WHERE ft.key IS NULL;
  IF v_unresolved <> 0 THEN
    RAISE EXCEPTION 'form_template_requirements crosswalk incomplete: % rows have unresolved template_type', v_unresolved;
  END IF;
  RAISE NOTICE 'form_template_requirements crosswalk: %/% rows resolve to form_types',
    v_total - v_unresolved, v_total;
END $$;

-- =============================================================================
-- POST-CHECKS — final invariants across the migration
-- =============================================================================

DO $$
DECLARE
  v_application_types int;
  v_intel_satellite int;
  v_intel_workspaces int;
  v_reserved_seats int;
  v_proc_seats int;
  v_form_types int;
  v_procurement_vehicles int;
BEGIN
  SELECT count(*) INTO v_application_types FROM public.application_types;
  IF v_application_types <> 6 THEN
    RAISE EXCEPTION 'application_types seed count wrong: % (expected 6)', v_application_types;
  END IF;

  SELECT count(*) INTO v_intel_workspaces
  FROM public.workspaces w
  JOIN public.application_types at ON at.id = w.application_type_id
  WHERE at.key = 'intelligence';
  SELECT count(*) INTO v_intel_satellite FROM public.intelligence_workspaces;
  IF v_intel_satellite <> v_intel_workspaces THEN
    RAISE EXCEPTION 'intel satellite/workspace count mismatch: satellite=%, workspaces=%',
      v_intel_satellite, v_intel_workspaces;
  END IF;

  -- 5 reserved seats + procurement seat = 6 satellite tables
  SELECT count(*) INTO v_reserved_seats
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'intelligence_workspaces',
      'sales_proposal_workspaces',
      'product_guide_workspaces',
      'competitor_research_workspaces',
      'training_onboarding_workspaces',
      'procurement_workspaces'
    );
  IF v_reserved_seats <> 6 THEN
    RAISE EXCEPTION 'reserved-seat count wrong: % (expected 6)', v_reserved_seats;
  END IF;

  SELECT count(*) INTO v_proc_seats FROM public.procurement_workspaces;
  RAISE NOTICE 'procurement_workspaces seeded: % rows (matches procurement-mapped workspaces)', v_proc_seats;

  SELECT count(*) INTO v_form_types FROM public.form_types;
  IF v_form_types <> 8 THEN
    RAISE EXCEPTION 'form_types seed count wrong: % (expected 8)', v_form_types;
  END IF;

  SELECT count(*) INTO v_procurement_vehicles FROM public.procurement_vehicles;
  IF v_procurement_vehicles <> 3 THEN
    RAISE EXCEPTION 'procurement_vehicles seed count wrong: % (expected 3)', v_procurement_vehicles;
  END IF;

  RAISE NOTICE 'T2 migration final: 6 application_types, 6 reserved seats, 8 form_types, 3 procurement_vehicles';
END $$;

COMMIT;

-- =============================================================================
-- Post-apply checklist (drafter / Liam):
--   1. Re-run intel TECH T-1..T-3 validation queries against staging post-push.
--   2. supabase gen types typescript --project-id <ref> > supabase/types/database.types.ts
--   3. bun run test full regression (intel subset 70/70 + baseline maintained).
--   4. UI smoke: open MAT Auditing intel workspace; verify company profile loads.
--   5. SCHEMA-QUICK-REFERENCE.md updates land in T4 follow-on (per PLAN §4.4).
-- =============================================================================
