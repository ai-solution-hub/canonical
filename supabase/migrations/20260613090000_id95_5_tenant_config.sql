-- ID-95.5 — public.tenant_config: per-instance client config document as DATA.
--
-- WHY THIS TABLE (TECH §T-A / §T-D, PI-10/PI-7/PI-9):
-- Each client lives in its OWN Supabase project (PI-5 physical isolation), so
-- the project's tenant_config holds EXACTLY ONE row — the current client's
-- config document. A client_id-keyed table would be a multi-tenant artefact
-- PI-6 forbids and PI-7 (no client literal) could not seed by name anyway.
-- The singleton CHECK mirrors public.signup_policy
-- (20260609160000_config_table_signup_domain_policy.sql).
--
-- The config jsonb holds the WHOLE current client document — the existing
-- BrandingConfigSchema-shaped JSON (branding colours/logos +
-- classificationDisambiguation + any future per-client config). Naming the
-- column `config` (not `branding`) makes the general-document intent explicit
-- so future per-client config lands without a schema change (TECH §T-D OQ-5).
--
-- CONFIG-AS-DATA: the config document is set out-of-band per environment via
-- the re-seed manifest (scripts/reseed-tenant-instance.ts, TECH §T-C), NEVER
-- committed in a migration — so NO client value enters tracked source. Same
-- property as signup_policy. NO client literal appears anywhere in this file.
--
-- CLOSED POSTURE (the DIFFERENCE from signup_policy, TECH §T-A(b)):
-- tenant_config is read ONLY by the build-time fetch
-- (scripts/fetch-client-branding.ts) authenticating with the project's
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS by Supabase default. Unlike
-- signup_policy — which must be readable by the supabase_auth_admin auth-hook
-- role and therefore carries a GRANT + a permissive SELECT policy —
-- tenant_config is NEVER read by a request-path role. So it gets NO permissive
-- SELECT policy and NO additional role GRANT: "service-role access only" is
-- achieved by denying every OTHER role, not by granting service_role. Deny-all
-- is the intended END STATE (PI-10 full closure).
--
-- Reference: specs/id-95-per-client-topology/TECH.md §T-A, §T-D.

-- (a) Single-row generic config table — NO client literal. Replay-safe.
CREATE TABLE IF NOT EXISTS public.tenant_config (
  id boolean PRIMARY KEY DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_config_singleton CHECK (id = true)
);

COMMENT ON TABLE public.tenant_config IS
  'Single-row per-instance client config document (branding + per-client config such as classificationDisambiguation). config jsonb is set out-of-band per environment via the re-seed manifest (scripts/reseed-tenant-instance.ts), NEVER in committed migrations, so no client value enters tracked source. Read ONLY by the build-time fetch (scripts/fetch-client-branding.ts) via the service-role key, which bypasses RLS. Deliberately closed to anon/authenticated (no permissive policy, no GRANT) — service-role access only (PI-10).';

-- (b) RLS deny-all, service-role only (PI-10).
-- service_role bypasses RLS by Supabase default; it is deliberately NOT listed
-- in this REVOKE and needs NO GRANT — "service-role access only" is achieved by
-- denying every OTHER role. No permissive SELECT policy and no extra GRANT is
-- added (the DIFFERENCE from signup_policy, which needs supabase_auth_admin
-- SELECT for its auth hook). The table is therefore unreachable from the public
-- app bundle's anon key — deny-all is the intended end state.
ALTER TABLE public.tenant_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_config FROM anon, authenticated, public;
