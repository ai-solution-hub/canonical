-- supabase/seed.sql
-- ----------------------------------------------------------------------
-- Knowledge Hub — branch + local-DB seeding script.
--
-- This file runs ONCE per branch creation, AFTER all migrations apply.
-- Re-run requires destroying and recreating (or resetting) the branch.
-- See: https://supabase.com/docs/guides/local-development/seeding-your-database
--
-- CONTRACT
-- --------
-- 1. SCHEMA-ONLY DATA: only data that is true across ALL client deployments.
--    Per-client data (product guides, sector guides, client-specific
--    CV overlays, real bid Q&A, company profiles) lives elsewhere
--    — see `docs/runbooks/staging-refresh.md` "Per-client seeding" section.
--
-- 2. IDEMPOTENT: every INSERT uses `ON CONFLICT … DO NOTHING` or the
--    `INSERT … SELECT … WHERE NOT EXISTS …` pattern, so re-running this file
--    against an already-seeded DB is a no-op.
--
-- 3. SCHEMA-VERSION-AWARE: when a migration adds a NOT NULL column to a table
--    seeded here, this file must update too. Add a checklist item to
--    `docs/runbooks/staging-refresh.md` to keep this in lockstep.
--
-- 4. NO PII: this file is committed to git. Do NOT include real client
--    content, real personal emails, real Q&A, real company profiles.
--    Synthetic test users only.
--
-- 5. NO AUTH-USERS via raw SQL: `auth.users` rows are seeded by
--    `scripts/seed-e2e-users.ts` post-reset (uses Supabase admin API).
--    See "Post-reset sequence" in the staging-refresh runbook.
--
-- 6. BRANCH-SCOPED CONFIG: per Supabase docs, persistent branches use the
--    `[remotes.<branch-name>]` block in `config.toml` for branch-specific
--    config. See `supabase/config.toml` `[remotes.staging.db.seed]` for the
--    explicit declaration that the staging persistent branch loads this file.

-- ======================================================================
-- §1  Pipeline service account (belt-and-suspenders)
-- ======================================================================
-- Migration 20260416122127_seed_pipeline_service_account.sql already
-- INSERTs this row, but branches that are reset after a schema-only
-- restore may miss it. ON CONFLICT DO NOTHING makes this idempotent.

SET search_path = public, extensions, auth;

-- 1a. auth.users row
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, is_sso_user, is_anonymous,
  confirmation_token, recovery_token,
  email_change_token_new, email_change_token_current,
  email_change, phone_change, phone_change_token, reauthentication_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated',
  'pipeline@system.knowledge-hub.internal',
  '!pipeline-service-account-no-login!',
  NOW(), NOW(), NOW(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"name":"Pipeline Service Account","system":true}'::jsonb,
  false, false, false,
  '', '', '', '', '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- 1b. auth.identities row
INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id,
  last_sign_in_at, created_at, updated_at
)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'sub', 'a0000000-0000-4000-8000-000000000001',
    'email', 'pipeline@system.knowledge-hub.internal',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  'a0000000-0000-4000-8000-000000000001',
  NOW(), NOW(), NOW()
)
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 1c. Admin role for pipeline service account
INSERT INTO public.user_roles (user_id, role)
VALUES ('a0000000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT (user_id) DO NOTHING;

-- ======================================================================
-- §2  Deterministic CI fixtures
-- ======================================================================
-- Tables with user-referencing data (created_by etc.) can't be restored
-- from production via pg_dump because production user UUIDs don't exist
-- on staging. Instead, we seed deterministic fixtures that reference the
-- pipeline service account (a0...01) which always exists.
--
-- UUID namespace convention (deterministic, easy to identify + clean up):
--   a0...01 = pipeline service account (§1 above)
--   b0...01 = CI test workspace
--   c0...01 = CI test guide
--   c0...02 = CI test guide section
--   d0...01 = CI test feed prompt
--   d0...02 = CI test feed source
--   e0...01 = CI test company profile

-- 2·0. Core application_types (the full 6-type durable ontology).
-- The core application_types were originally established by early migrations
-- ("migration 1.4 backfill" + the S246 T2 6-type seed) that were FOLDED INTO
-- the 20260617130000_squash_baseline squash — but the squash captured only the
-- application_types SCHEMA, not its core DATA rows (same squash-fidelity gap as
-- the ensure_rls event trigger; see id-115 {115.15}). On a fresh/reset DB or a
-- freshly-provisioned Supabase branch the table is therefore EMPTY, so §2a's
-- `WHERE key = 'procurement'` subquery returns NULL and the workspace insert
-- aborts with a NOT-NULL violation on application_type_id; and the /workspaces
-- launcher renders no cards (e2e/tests/workspaces.spec.ts @smoke needs the
-- Procurements card + the Sales Proposals coming-soon card). Re-seed ALL SIX
-- client-agnostic core rows here (provenance 'core', identical across every
-- deployment — the durable-core-ontology pattern of §4), mirroring the live
-- Platform/client DBs EXACTLY (label, label_plural, description, icon, colour).
-- active-vs-coming-soon is CODE-side (CLIENT_CONFIG in
-- hooks/workspaces/use-application-types.ts), NOT data, so this seed is purely
-- the ontology rows. DO UPDATE (not DO NOTHING) so a stale row self-corrects on
-- re-seed — e.g. a pre-S248 singular label_plural 'Procurement' is rewritten to
-- 'Procurements'. UUIDs are deterministic but immaterial — every consumer
-- resolves by key.
INSERT INTO public.application_types (id, key, label, label_plural, description, default_icon, default_colour, provenance)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'procurement',         'Procurement',         'Procurements',          'Manage bid responses and tender submissions using your knowledge base', 'briefcase',      '#d4880f', 'core'),
  ('a1000000-0000-4000-8000-000000000002', 'intelligence',        'Intelligence',        'Intelligence Streams',  'Sector and competitor news feeds tailored to your company profile.',     'newspaper',      '#059669', 'core'),
  ('a1000000-0000-4000-8000-000000000003', 'sales_proposal',      'Sales Proposal',      'Sales Proposals',       'Draft and manage sales proposals drawing on your knowledge base',        'file-signature', '#0d9488', 'core'),
  ('a1000000-0000-4000-8000-000000000004', 'product_guide',       'Product Guide',       'Product Guides',        'Product Guide',                                                         NULL,             NULL,      'core'),
  ('a1000000-0000-4000-8000-000000000005', 'competitor_research', 'Competitor Research', 'Competitor Researchs',  'Competitor Research',                                                   NULL,             NULL,      'core'),
  ('a1000000-0000-4000-8000-000000000006', 'training_onboarding', 'Training Onboarding', 'Training Onboardings',  'Training Onboarding',                                                   NULL,             NULL,      'core')
ON CONFLICT (key) DO UPDATE SET
  label         = EXCLUDED.label,
  label_plural  = EXCLUDED.label_plural,
  description   = EXCLUDED.description,
  default_icon  = EXCLUDED.default_icon,
  default_colour = EXCLUDED.default_colour,
  provenance    = EXCLUDED.provenance,
  updated_at    = now();

-- 2·0b. Core form_types CV (the seven-type durable ontology).
-- Same squash-fidelity gap as §2·0: the pre-squash form_type seed (in
-- 20260520120828_t2_combined_pr_intel_shape_b_form_type_split) was FOLDED INTO the
-- 20260617130000 squash as SCHEMA-only — the squash CREATEd public.form_types but DROPPED
-- its core DATA rows. On a fresh/reset DB or a freshly-provisioned branch the table is
-- EMPTY, so any FK to form_types.key breaks.
-- Re-seed the seven remaining client-agnostic core rows here (provenance 'core', identical
-- across every deployment), mirroring the live Platform/client DBs. Key is 'psq' (NOT the
-- pre-2023 'pqq' — ID-130 AD-4 re-keyed it for Procurement Act 2023 supplier-selection
-- terminology; spine 20260625120000 STEP 6). DO UPDATE so a stale label/key self-corrects
-- on re-seed.
--
-- DELIBERATE EXCEPTION — no 'bid' tuple (ID-145 BI-8/BI-12, {145.27}+{145.28}, S474):
-- ID-130 {130.8} originally minted form_type='bid' as this CV's eighth row, but migration
-- 20260712065000_id145_bi8_retire_bid_creation_label.sql retires 'Bid' as a first-class
-- creation label by DELETE-ing form_types.key='bid'. That migration runs BEFORE this seed
-- file (seed.sql applies AFTER all migrations — see file header §0) and form_types is
-- still empty at migration-apply time (the squash-fidelity gap above), so its guarded
-- DELETE is a harmless no-op against an empty table on a fresh DB. Seeding 'bid' here would
-- silently resurrect the exact row that migration exists to retire — so it is intentionally
-- omitted, not an oversight. __tests__/supabase/seed-squash-fidelity-guard.test.ts's
-- form_types expectedKeys list was updated in the same commit to match.
INSERT INTO public.form_types (key, label, provenance, applicable_application_types)
VALUES
  ('rfp',                     'RFP (Request For Proposal)',       'core', ARRAY['procurement']),
  ('psq',                     'Selection Questionnaire (SQ/PSQ)', 'core', ARRAY['procurement']),
  ('itt',                     'ITT (Invitation To Tender)',       'core', ARRAY['procurement']),
  ('tender',                  'Tender',                           'core', ARRAY['procurement']),
  ('checklist',               'Checklist',                        'core', ARRAY['procurement','sales_proposal','product_guide']),
  ('questionnaire',           'Questionnaire',                    'core', ARRAY['procurement','competitor_research']),
  ('sales_proposal_template', 'Sales Proposal Template',          'core', ARRAY['sales_proposal'])
ON CONFLICT (key) DO UPDATE SET
  label                        = EXCLUDED.label,
  provenance                   = EXCLUDED.provenance,
  applicable_application_types = EXCLUDED.applicable_application_types;

-- 2·0c/2·0d. procurement_vehicles + procurement_vehicle_instances — REMOVED
-- ({145.28}, S474). Both tables were re-homed here at ID-130.19 to close the same
-- squash-fidelity gap as §2·0/§2·0b, but ID-145 {145.6} W1e
-- (20260712064000_id145_w1e_drop_workspace_stratum.sql STEP 3) DROPPED both tables
-- outright (TECH.md §2 M5; ARCH-REVIEW C9 — zero code refs, zero inbound FKs from any
-- surviving table). The CV rows this section used to re-home no longer have a table to
-- insert into — seeding them here fails with "relation does not exist" against a fresh
-- post-W1 database (first observed on the e2e-nightly ephemeral-branch provisioning run,
-- S474). The guard test's matching procurement_vehicles / procurement_vehicle_instances
-- cases (and the standalone vehicle_key FK-resolution test) were removed from
-- __tests__/supabase/seed-squash-fidelity-guard.test.ts in the same commit.

-- 2a. Test workspace (required by feed_prompts, feed_sources, and E2E tests)
-- NB: `workspaces.type` (was 'bid') was DROPPED in 20260520120828
-- (t2_combined_pr_intel_shape_b_form_type_split) and replaced by a NOT-NULL
-- `application_type_id` FK to application_types. Old 'bid' maps to the
-- 'procurement' application_type (migration 1.4 backfill). Resolved via a
-- key-subquery because application_types.id is gen_random_uuid() — NOT stable
-- across branches — so a literal UUID would break on any fresh branch.
INSERT INTO public.workspaces (id, name, description, application_type_id, created_by)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'CI Test Workspace',
  'Deterministic workspace for CI integration and E2E tests. Seeded by seed.sql.',
  (SELECT id FROM public.application_types WHERE key = 'procurement'),
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2b. Test guide (used by guide-related features and E2E tests)
INSERT INTO public.guides (id, slug, name, description, guide_type, is_published, created_by)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'ci-test-guide',
  'CI Test Guide',
  'Deterministic guide for CI tests. Seeded by seed.sql.',
  'sector',
  true,
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2c. Test guide sections — >=3 so the guide-detail Table of Contents renders.
-- GuideTableOfContents (components/guide/guide-table-of-contents.tsx) has
-- minSections=3 and returns null below that, so guide-pages.spec.ts @smoke
-- ("shows table of contents when sections exist") needs at least three.
INSERT INTO public.guide_sections (id, guide_id, section_name, description, display_order)
VALUES
  ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Overview', 'Deterministic guide section for CI tests.', 0),
  ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'Market Landscape', 'Deterministic guide section for CI tests.', 1),
  ('c0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'Key Considerations', 'Deterministic guide section for CI tests.', 2)
ON CONFLICT (id) DO NOTHING;

-- 2d. Test feed prompt (requires workspace + created_by)
INSERT INTO public.feed_prompts (id, workspace_id, prompt_text, version, is_active, created_by)
VALUES (
  'd0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'CI test feed prompt for integration tests.',
  1,
  true,
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2e. Test feed source (requires workspace + created_by)
INSERT INTO public.feed_sources (id, workspace_id, name, url, source_type, created_by)
VALUES (
  'd0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000001',
  'CI Test Feed',
  'https://example.com/ci-test-feed.xml',
  'rss',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2f. Test company profile
INSERT INTO public.company_profiles (id, name, slug, created_by)
VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'CI Test Company',
  'ci-test-company',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- ======================================================================
-- §3  Reference data (seeded directly by §4)
-- ======================================================================
-- id-417 C6/B2: the weekly staging-reference-refresh workflow that used to
-- populate these lookup tables from Platform prod is RETIRED. §4 below is now
-- the sole source of the reference baseline (layer_vocabulary,
-- entity_aliases — the taxonomy_domains/taxonomy_subtopics rows retired with
-- their tables at 20260805190000, DR-130),
-- so a fresh/reset DB always has the client-agnostic ontology CI depends on.
-- Tables with user-referencing data use the deterministic fixtures above.
-- form_requirement_templates is populated by ingest, not by seed.
--
-- POST-RESET SEQUENCE:
--   1. Branch reset (runs migrations + this seed.sql)
--   2. bun run seed:e2e-users  (creates 3 test auth accounts + roles)
--
-- See the staging-refresh runbook in the private docs-site for full procedure.
--
-- Measured at retirement (S529): prod carried no reference rows that §4 does not
-- already seed, while its DELETE step wiped staging-only rows every Monday.

-- ======================================================================
-- §4  Core ontology reference data (baseline/core provenance only — NO client data; see ID/bl platform-seed)
-- ======================================================================
-- Pulled from old-prod (provenance-tagged) restricted to the client-agnostic
-- CORE/BASELINE subset that is safe for this PUBLIC repo. UUIDs are preserved
-- verbatim. Idempotent via ON CONFLICT on the natural key; the two blocks are
-- independent. (§4a/4b taxonomy_domains + taxonomy_subtopics retired with
-- their tables at 20260805190000, DR-130.)
-- Re-derivable from the docs-site ontology config (ontology/01..03) + old-prod.

-- 4c. layer_vocabulary (4 core rows; natural key = key)
INSERT INTO public.layer_vocabulary
  (id, key, label, description, display_order, is_active)
VALUES
  ('d9fbcd98-f865-4229-8497-f82fae611973', 'sales_brief', 'Sales Brief', 'Positioning and messaging for internal sales', 10, true),
  ('01fe4de1-4f3c-433e-8f08-191f10ce54dd', 'bid_detail', 'Bid Detail', 'Factual content for tender responses', 20, true),
  ('3c2ce19c-e8f1-40a5-8c60-8912737b4572', 'company_reference', 'Company Reference', 'Controlled corporate documents', 30, true),
  ('4509e22e-defc-4dde-9a71-ee8e24e32f89', 'research', 'Research', 'Background material and market intelligence', 40, true)
ON CONFLICT (key) DO NOTHING;

-- 4d. entity_aliases (14 core; natural key = alias)
INSERT INTO public.entity_aliases
  (id, alias, canonical, provenance, is_active)
VALUES
  ('5cd5d588-9dda-4784-b229-1459fe990c10', 'agile', 'Agile', 'core', true),
  ('d96e4be4-724a-43a1-af07-1c794855791c', 'Asp Net', 'ASP.NET', 'core', true),
  ('4a896874-39c3-45c6-b6b8-e3d9e475bf49', 'Asp.net', 'ASP.NET', 'core', true),
  ('bdc0fe5d-a155-4b4e-80e4-69bd01cfd3e0', 'csharp', 'C#', 'core', true),
  ('b56d2c85-d2af-434d-b529-bb27f9690f55', 'Csharp', 'C#', 'core', true),
  ('07697080-e385-4f0c-8d73-045d32903dee', 'Hcaptcha', 'hCaptcha', 'core', true),
  ('52c458fc-48ed-4afd-888d-62bc2902bc41', 'ISO 27000', 'ISO 27001', 'core', true),
  ('6c7b55ec-2d80-4a40-97a0-f33569926948', 'ISO 27001 2013', 'ISO 27001', 'core', true),
  ('29e2d519-73aa-4b7f-ac46-7a6439642e01', 'ISO 9001 2015', 'ISO 9001', 'core', true),
  ('cf675a6c-07be-4bf5-837a-0a96b2037c19', 'ISO 27001', 'iso 27001', 'core', true),
  ('f517cbac-f762-4f0b-8cf7-70048a8797ba', 'Iso Certifications', 'ISO 27001', 'core', true),
  ('f2439cdd-7c7a-49fe-a9b0-03fe2418f8c7', 'Wcag 2 1 Aa', 'WCAG 2.1 AA', 'core', true),
  ('3d88243a-bcff-4c9a-91ac-c0283324eea2', 'wordpress', 'WordPress', 'core', true),
  ('8d2a2b69-cd31-469e-a155-9395df9d5954', 'Wordpress', 'WordPress', 'core', true)
ON CONFLICT (alias) DO NOTHING;
