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
--    taxonomy customisations, real bid Q&A, company profiles) lives elsewhere
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

-- 2g. Test content item (required by publication-status-migration integration
--     tests AC1.1/AC1.2 which probe content_items for structural assertions).
INSERT INTO public.content_items (
  id, title, suggested_title, content, content_type, platform,
  captured_date, publication_status, created_by
)
VALUES (
  'f0000000-0000-4000-8000-000000000001',
  'CI Test Content Item',
  'CI Test Content Item',
  'Deterministic content item for CI integration tests. Seeded by seed.sql.',
  'article',
  'manual',
  NOW(),
  'published',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- ======================================================================
-- §3  Reference data (via staging-reference-refresh workflow)
-- ======================================================================
-- Pure lookup tables (taxonomy_domains, taxonomy_subtopics, layer_vocabulary,
-- entity_aliases, template_requirements, taxonomy_sync_state) are populated
-- by the staging-reference-refresh workflow after branch reset.
-- Tables with user-referencing data use deterministic fixtures above instead.
--
-- POST-RESET SEQUENCE:
--   1. Branch reset (runs migrations + this seed.sql)
--   2. bun run seed:e2e-users  (creates 3 test auth accounts + roles)
--   3. Dispatch staging-reference-refresh workflow (populates 6 lookup tables)
--
-- See docs/runbooks/staging-refresh.md for full procedure.
--
-- NOTE: §4 below now seeds the CORE/BASELINE subset of the reference lookup
-- tables (taxonomy_domains, taxonomy_subtopics, layer_vocabulary,
-- entity_aliases, taxonomy_sync_state) directly, so a fresh/reset DB always has
-- the client-agnostic ontology that CI depends on. The staging-reference-refresh
-- workflow still layers any client-provenance rows on top post-reset.

-- ======================================================================
-- §4  Core ontology reference data (baseline/core provenance only — NO client data; see ID/bl platform-seed)
-- ======================================================================
-- Pulled from old-prod (provenance-tagged) restricted to the client-agnostic
-- CORE/BASELINE subset that is safe for this PUBLIC repo. EXCLUDES every
-- provenance='client' row and provenance='recommended' subtopics. UUIDs are
-- preserved verbatim so taxonomy_subtopics.domain_id -> taxonomy_domains.id
-- resolves. Idempotent via ON CONFLICT on the natural key. FK-safe order:
-- taxonomy_domains -> taxonomy_subtopics; the other three are independent.
-- Re-derivable from the docs-site ontology config (ontology/01..03) + old-prod.

-- 4a. taxonomy_domains (7 baseline; natural key = name)
INSERT INTO public.taxonomy_domains
  (id, name, description, display_order, colour, is_active, provenance, display_name, key_signal)
VALUES
  ('17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'security', 'Information security, data protection, cyber security, and access control policies and practices.', 1, 'security', true, 'baseline', 'security', $tok$**Key signal:** Content about protecting information, systems, and data —
controls, policies, and security practices. The substance is about HOW security
is managed, not merely that a certification exists.$tok$),
  ('8d6c0b63-f77c-4021-a54b-15c07fa04420', 'compliance', 'Regulatory compliance, industry standards, certifications, and audit processes.', 2, 'compliance', true, 'baseline', 'compliance', $tok$**Key signal:** Content about proving adherence to external requirements —
standards bodies, regulators, auditors. The focus is on the obligation or
evidence, not the underlying practice. For H&S, environmental, and modern
slavery subtopics, the signal is physical safety, environmental impact, or
ethical supply chain — not information security or data protection.$tok$),
  ('7ea9e1ca-0a99-48e4-8a38-0aff9b910e7b', 'implementation', 'Solution deployment, system migration, client onboarding, and third-party integration.', 3, 'implementation', true, 'baseline', 'implementation', $tok$**Key signal:** Content about concrete delivery activities — what happens, when
it happens, and how the transition is managed. Answers the question "What do you
do to get the client live?"$tok$),
  ('d234988f-f548-4ea6-afbd-3aa7969674bd', 'support', 'Service level agreements, helpdesk operations, maintenance, and incident management.', 4, 'support', true, 'baseline', 'support', $tok$**Key signal:** Content about keeping a live service running — BAU operations,
response commitments, and what happens when things go wrong. Answers the
question "How do you look after the service once it is live?"$tok$),
  ('2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'corporate', 'Company information, financial standing, insurance, references, and staffing.', 5, 'corporate', true, 'baseline', 'corporate', $tok$**Key signal:** Content about the organisation itself — who you are, your track
record, your people, and your financial health. Answers the question "Tell us
about your company."$tok$),
  ('609bbcc4-ea14-4d74-b53d-d074ddce19a4', 'product-feature', 'Product functionality, technical capabilities, reporting, and usability.', 6, 'product', true, 'baseline', 'product-feature', $tok$**Key signal:** Content about what the product or platform CAN do — its
capabilities, architecture, and user experience. Answers the question "What does
your system do?"$tok$),
  ('047b2b0f-59a1-4242-bbc8-b912c57d29aa', 'methodology', 'Project delivery approach, project management, quality assurance, and delivery frameworks.', 7, 'methodology', true, 'baseline', 'methodology', $tok$**Key signal:** Content about HOW you work — your processes, governance, and
quality practices. Answers the question "What is your approach to delivering
projects?"$tok$)
ON CONFLICT (name) DO NOTHING;

-- 4b. taxonomy_subtopics (34 baseline; natural key = (domain_id, name))
INSERT INTO public.taxonomy_subtopics
  (id, domain_id, name, description, display_order, is_active, provenance, display_name)
VALUES
  ('de0bd12e-607c-43e2-bfa3-e372096ff66e', '17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'data-protection', 'GDPR, data handling, privacy policies, data retention and disposal', 1, true, 'baseline', 'data-protection'),
  ('cf09c33d-f7a3-4cd3-884c-867745b882ad', '17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'cyber-security', 'Threat detection, vulnerability management, penetration testing, security monitoring', 2, true, 'baseline', 'cyber-security'),
  ('338e233d-a056-4267-b50d-304ea9aa90b8', '17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'encryption', 'Data encryption at rest and in transit, key management, cryptographic standards', 3, true, 'baseline', 'encryption'),
  ('844b1177-4da2-40b6-bd13-83b14c4456d0', '17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'access-control', 'Authentication, authorisation, role-based access, multi-factor authentication', 4, true, 'baseline', 'access-control'),
  ('d40979c1-ec77-4d2b-aca0-b8be8c748c06', '17d9f23f-1c4f-4d6d-b9c3-f37c178a547e', 'iso-27001', 'ISO 27001 certification, ISMS, security management framework compliance', 5, true, 'baseline', 'iso-27001'),
  ('5a9fef89-13a0-4512-84d1-0aacd31707aa', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'standards', 'Industry standards compliance, best practice frameworks, governance requirements', 1, true, 'baseline', 'standards'),
  ('b7486e15-de9b-4e85-9e01-ed1d0ba0df53', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'regulatory', 'Legal and regulatory requirements, sector-specific regulations, compliance obligations', 2, true, 'baseline', 'regulatory'),
  ('b367636e-a9d1-453c-9801-7aa1cc1b6488', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'audit', 'Audit processes, evidence gathering, compliance reporting, third-party audits', 3, true, 'baseline', 'audit'),
  ('00e6192a-c6d0-4fe8-9c3a-bf89b48f0776', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'certification', 'Professional certifications, organisational accreditations, quality marks', 4, true, 'baseline', 'certification'),
  ('48baad22-24bd-4434-a492-27bacf94bd70', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'health-and-safety', 'Health and safety policy, risk assessments, incident reporting, RIDDOR, CDM regulations', 5, true, 'baseline', 'health-and-safety'),
  ('e2ab8b62-e838-4e4b-b6ab-466a411fcd3b', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'environmental', 'Carbon reduction plan, net zero targets, environmental policy, ISO 14001, sustainability, PPN 06/20', 6, true, 'baseline', 'environmental'),
  ('d3318f02-34f4-4d3f-b923-e94d9bbf4e64', '8d6c0b63-f77c-4021-a54b-15c07fa04420', 'modern-slavery', 'Modern slavery statement, supply chain due diligence, forced labour prevention, PPN 02/23', 7, true, 'baseline', 'modern-slavery'),
  ('ff5e3789-fc77-4904-9fde-ed26392fc224', '7ea9e1ca-0a99-48e4-8a38-0aff9b910e7b', 'deployment', 'Solution rollout, environment setup, go-live planning, deployment processes', 1, true, 'baseline', 'deployment'),
  ('14f33f1e-c69b-4ffe-a6d5-841cdecdd8a0', '7ea9e1ca-0a99-48e4-8a38-0aff9b910e7b', 'migration', 'Data migration, system transition, legacy replacement, cutover planning', 2, true, 'baseline', 'migration'),
  ('5ad3bdc7-f536-4559-9934-baacd028a36b', '7ea9e1ca-0a99-48e4-8a38-0aff9b910e7b', 'onboarding', 'Client onboarding, user training, adoption support, change management', 3, true, 'baseline', 'onboarding'),
  ('d9c2678f-074b-4680-ba71-516246cfe6f2', '7ea9e1ca-0a99-48e4-8a38-0aff9b910e7b', 'integration', 'API integration, third-party systems, data exchange, interoperability', 4, true, 'baseline', 'integration'),
  ('e07d008f-f7b8-43d6-9190-2a2f4b52cbbe', 'd234988f-f548-4ea6-afbd-3aa7969674bd', 'sla', 'Service level agreements, uptime guarantees, response times, performance targets', 1, true, 'baseline', 'sla'),
  ('bd79809d-2e72-4e34-8165-4876a5d28fbc', 'd234988f-f548-4ea6-afbd-3aa7969674bd', 'helpdesk', 'Support desk operations, ticket management, escalation procedures, user support', 2, true, 'baseline', 'helpdesk'),
  ('2f8bf860-ad6c-48d0-9835-7c13f51c5a54', 'd234988f-f548-4ea6-afbd-3aa7969674bd', 'maintenance', 'Scheduled maintenance, patching, updates, system health monitoring', 3, true, 'baseline', 'maintenance'),
  ('5665e422-c718-47f6-a3f7-b0f7a7eeca02', 'd234988f-f548-4ea6-afbd-3aa7969674bd', 'incident', 'Incident response, disaster recovery, business continuity, root cause analysis', 4, true, 'baseline', 'incident'),
  ('c3fa88b4-b98c-448f-85ff-e6b6ac44e4e1', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'company-info', 'Company overview, history, mission, organisational structure', 1, true, 'baseline', 'company-info'),
  ('111bbaea-6070-4100-ba6f-99cf388e0a32', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'financial', 'Financial statements, turnover, profitability, financial stability', 2, false, 'baseline', 'financial'),
  ('1aa59827-104c-4434-9b09-767e214cda18', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'insurance', 'Professional indemnity, public liability, cyber insurance, coverage details', 3, true, 'baseline', 'insurance'),
  ('d63daabd-c690-4f11-9244-d4dff43633f6', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'references', 'Client references, case studies, testimonials, similar contract experience', 4, true, 'baseline', 'references'),
  ('4256a5bc-9103-425c-88b0-3a7f7c894de1', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'staffing', 'Team structure, key personnel, CVs, recruitment and retention', 5, true, 'baseline', 'staffing'),
  ('ae221eeb-52e1-4a9e-b2a9-3a1664c75909', '2cf9db4f-fa8d-4c7b-97ce-c3ce6f966f1b', 'supply-chain', 'Supply chain management, prompt payment, subcontractor oversight, PPN 02/23', 6, true, 'baseline', 'supply-chain'),
  ('de5d47f0-6f59-4d13-9cb3-a9561230bfc0', '609bbcc4-ea14-4d74-b53d-d074ddce19a4', 'functionality', 'Core product features, capabilities, modules, feature descriptions', 1, true, 'baseline', 'functionality'),
  ('51294099-2a34-4f59-b5bc-853ee8e7772b', '609bbcc4-ea14-4d74-b53d-d074ddce19a4', 'technical', 'Technical architecture, infrastructure, hosting, technology stack', 2, true, 'baseline', 'technical'),
  ('67f2614a-cbbf-404c-b89d-3be456f182c0', '609bbcc4-ea14-4d74-b53d-d074ddce19a4', 'reporting', 'Reporting capabilities, dashboards, analytics, management information', 3, true, 'baseline', 'reporting'),
  ('69583689-3a44-46ba-a9a3-b009043858e5', '609bbcc4-ea14-4d74-b53d-d074ddce19a4', 'usability', 'User experience, accessibility, interface design, ease of use', 4, true, 'baseline', 'usability'),
  ('451b58a4-c34e-4926-b897-5149f819594a', '047b2b0f-59a1-4242-bbc8-b912c57d29aa', 'approach', 'Delivery methodology, project approach, ways of working, agile/waterfall', 1, true, 'baseline', 'approach'),
  ('4ec4990d-135a-4cd3-b582-c41ce4b644d2', '047b2b0f-59a1-4242-bbc8-b912c57d29aa', 'project-management', 'Project governance, milestones, risk management, stakeholder communication', 2, true, 'baseline', 'project-management'),
  ('944db61d-3ed2-4938-8381-a00b4c71c5ca', '047b2b0f-59a1-4242-bbc8-b912c57d29aa', 'quality', 'Quality assurance, testing strategy, acceptance criteria, continuous improvement', 3, true, 'baseline', 'quality'),
  ('9c5f4c1c-a509-41bd-a734-c24fb69dc875', '047b2b0f-59a1-4242-bbc8-b912c57d29aa', 'delivery', 'Delivery timelines, phased rollout, resource planning, capacity management', 4, true, 'baseline', 'delivery')
ON CONFLICT (domain_id, name) DO NOTHING;

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
  ('cf675a6c-07be-4bf5-837a-0a96b2037c19', 'ISO Certification', 'ISO 27001', 'core', true),
  ('f517cbac-f762-4f0b-8cf7-70048a8797ba', 'Iso Certifications', 'ISO 27001', 'core', true),
  ('f2439cdd-7c7a-49fe-a9b0-03fe2418f8c7', 'Wcag 2 1 Aa', 'WCAG 2.1 AA', 'core', true),
  ('3d88243a-bcff-4c9a-91ac-c0283324eea2', 'wordpress', 'WordPress', 'core', true),
  ('8d2a2b69-cd31-469e-a155-9395df9d5954', 'Wordpress', 'WordPress', 'core', true)
ON CONFLICT (alias) DO NOTHING;

-- 4e. taxonomy_sync_state (1 row; only PK id available as conflict target)
INSERT INTO public.taxonomy_sync_state
  (id, last_sync_hash, last_sync_at, synced_by, created_at, updated_at)
VALUES
  ('e4aa0630-ac32-4ffb-b418-6c01848ecf71', '8e928ea13dfb5296be64b77d4baf0a69e9b7b3e3665763ba0937fb5510896914', '2026-04-28 10:39:45.7+00', 'workflow', '2026-04-22 07:02:51.23626+00', '2026-04-28 10:39:45.7+00')
ON CONFLICT (id) DO NOTHING;
