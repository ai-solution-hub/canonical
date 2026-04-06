-- ============================================================
-- SI-H2: Create pipeline service account user
-- ============================================================
--
-- Purpose:
--   The Sector Intelligence (SI) pipeline calls classifyContent() with a
--   userId parameter for audit/attribution. It uses a fixed service account
--   user (PIPELINE_SYSTEM_USER_ID in lib/intelligence/types.ts) so that
--   pipeline-originated writes are attributable and pass RLS write policies.
--
--   This account was originally inserted manually into the live DB during
--   Session 149, leaving zero footprint in migrations. As a result, fresh
--   environments (staging, local dev, disaster recovery) would silently
--   fail when the pipeline ran. This migration restores parity by
--   idempotently provisioning the user in both auth.users and
--   public.user_roles.
--
-- Idempotency:
--   Safe to re-run on environments where the user already exists. Both
--   inserts use ON CONFLICT DO NOTHING. The live DB already has this row,
--   so this migration is effectively a no-op there but is a hard
--   requirement for fresh environments.
--
-- Login behaviour:
--   The encrypted_password field is set to a sentinel value that cannot
--   match any bcrypt verification (it is not a valid bcrypt hash), so the
--   account cannot be used for interactive login. The account is solely
--   for pipeline server-side writes.
-- ============================================================

SET search_path = public, extensions, auth;

-- 1. Insert into auth.users (Supabase auth schema)
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  is_anonymous
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'pipeline@system.knowledge-hub.internal',
  -- Sentinel: not a valid bcrypt hash, so password verification always fails.
  -- The pipeline never logs in interactively; it uses the service role key.
  '!pipeline-service-account-no-login!',
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"name":"Pipeline Service Account","system":true}'::jsonb,
  false,
  false,
  false
)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert into public.user_roles with admin role
--    Admin role required so the pipeline can write across all RLS-protected
--    tables (content_items, entity_mentions, embeddings, etc.).
INSERT INTO public.user_roles (user_id, role)
VALUES ('a0000000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT (user_id) DO NOTHING;
