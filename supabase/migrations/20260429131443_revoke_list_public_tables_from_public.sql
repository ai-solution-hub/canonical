-- ─────────────────────────────────────────────────────────────────────────────
-- S14 WP3 fix-up — REVOKE PUBLIC EXECUTE on public.list_public_tables()
--
-- Verifier finding F1 (Wave 4): the prior migration `s13_followups` granted
-- EXECUTE explicitly to authenticated + service_role, but Postgres'
-- `CREATE OR REPLACE FUNCTION` defaults to GRANT EXECUTE TO PUBLIC. The
-- explicit GRANT adds; it does NOT replace. anon (member of PUBLIC)
-- therefore retained EXECUTE access despite the prior migration's documented
-- intent to exclude anon from schema-metadata RPCs.
--
-- This follow-up REVOKEs the PUBLIC default so the explicit
-- authenticated + service_role grants become the effective ACL.
-- Idempotent: REVOKE on a non-grant is a no-op (no error).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.list_public_tables() FROM PUBLIC;
