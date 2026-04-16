-- ============================================================
-- Post-squash: Pipeline service account seed
-- ============================================================
-- The S176 migration squash (43→1) used pg_dump which only captures DDL,
-- not DML. The original pipeline service account INSERT (S149, formalised
-- in 20260406180000) and the S156 shape fix (20260408134124) were both
-- DML statements that were dropped during squash.
--
-- This migration restores the pipeline service account on fresh environments.
-- On the current production DB, both INSERTs are no-ops (ON CONFLICT DO NOTHING).
--
-- The service account:
--   - UUID: a0000000-0000-4000-8000-000000000001
--   - Cannot log in (sentinel password, not a valid bcrypt hash)
--   - Used for pipeline server-side writes (classification, entity extraction)
--   - Requires admin role to pass RLS write policies
-- ============================================================

SET search_path = public, extensions, auth;

-- 1. Insert pipeline service account into auth.users
--    Token columns initialised to '' (not NULL) per S156 fix.
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
  is_anonymous,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change_token_current,
  email_change,
  phone_change,
  phone_change_token,
  reauthentication_token
)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'pipeline@system.knowledge-hub.internal',
  '!pipeline-service-account-no-login!',
  NOW(),
  NOW(),
  NOW(),
  '{"provider":"system","providers":["system"]}'::jsonb,
  '{"name":"Pipeline Service Account","system":true}'::jsonb,
  false,
  false,
  false,
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert corresponding auth.identities row (S156 fix shape)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
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
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 3. Grant admin role to pipeline service account
INSERT INTO public.user_roles (user_id, role)
VALUES ('a0000000-0000-4000-8000-000000000001', 'admin')
ON CONFLICT (user_id) DO NOTHING;
