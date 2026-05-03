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
--    Per-client data (example-client Product Guides, example-client Sector Guides, client-specific
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

-- 2a. Test workspace (required by feed_prompts, feed_sources, and E2E tests)
INSERT INTO public.workspaces (id, name, description, type, created_by)
VALUES (
  'b0000000-0000-4000-8000-000000000001',
  'CI Test Workspace',
  'Deterministic workspace for CI integration and E2E tests. Seeded by seed.sql.',
  'bid',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2b. Test guide (used by guide-related features and E2E tests)
INSERT INTO public.guides (id, slug, name, description, guide_type, created_by)
VALUES (
  'c0000000-0000-4000-8000-000000000001',
  'ci-test-guide',
  'CI Test Guide',
  'Deterministic guide for CI tests. Seeded by seed.sql.',
  'sector',
  'a0000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- 2c. Test guide section
INSERT INTO public.guide_sections (id, guide_id, section_name, description, display_order)
VALUES (
  'c0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',
  'Overview',
  'Deterministic guide section for CI tests.',
  0
)
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
