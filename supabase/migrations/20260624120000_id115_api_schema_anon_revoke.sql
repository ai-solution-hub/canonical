-- ID-115 hardening — api-schema function ACL least-privilege replay.
--
-- The 20260617130000 squash baseline captured the api-schema function SCHEMA
-- but NOT the ID-115 EXECUTE-grant discipline (the same squash-fidelity gap as
-- the application_types core rows and the {115.15} ensure_rls event trigger).
-- Every fresh apply of the baseline therefore defaults the api RPCs to
-- anon / PUBLIC EXECUTE: measured 72 of 73 api functions anon-callable on the
-- Platform DBs (prod zjqbr… and the persistent staging branch) versus the
-- intended 1 on the client projects. Because the Data API exposes the `api`
-- schema (db_schema = 'api'), those 72 INVOKER RPCs are reachable by any holder
-- of the anon / publishable key WITHOUT authentication. The api entrypoints are
-- INVOKER (security_invoker) so RLS still applies — this is a least-privilege /
-- attack-surface regression, not an RLS bypass — but it diverges from the
-- proven client posture and must be closed.
--
-- Re-establish least privilege to match the client: anon may EXECUTE ONLY
-- set_config (the lone intended anon entrypoint — ID-115 INV-20, the RLS GUC
-- context setter). authenticated + service_role explicit grants are preserved
-- as-is, except the three auth-probe / count helpers which are service_role-only
-- on the client and must not be reachable by authenticated either.
--
-- api functions are all explicit-ACL (no default/PUBLIC-only grants), so the
-- schema-wide REVOKE removes the explicit anon grants without disturbing the
-- authenticated / service_role grants. Re-runnable (idempotent) — a no-op once
-- the posture is already in place.
--
-- NOTE: this migration intentionally scopes to the EXPOSED `api` schema only.
-- The public schema is NOT reachable via the Data API (db_schema = 'api'); its
-- residual anon/PUBLIC grants are latent defence-in-depth and are addressed
-- separately (they require per-function care for the default-ACL helpers).

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC, anon;

-- Match the client: these are service_role-only (never authenticated/anon).
REVOKE EXECUTE ON FUNCTION api._test_delete_broken_auth_user(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION api._test_insert_broken_auth_user(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION api.count_auth_users() FROM authenticated;

-- Restore the single intended anon entrypoint (ID-115 INV-20).
GRANT EXECUTE ON FUNCTION api.set_config(text, text, boolean) TO anon;
