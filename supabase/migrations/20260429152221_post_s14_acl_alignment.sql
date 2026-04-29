-- Post-S14 ACL alignment: idempotent re-affirm + pg_default_acl documentation
-- anchor.
--
-- Background. f07d4bb7 (S14 WP3 Wave 4) authored the canonical REVOKE EXECUTE
-- on list_public_tables() from PUBLIC + anon, after Wave 4 verifier F1
-- surfaced that Supabase's pg_default_acl auto-grants anon EXECUTE on every
-- public.* function created by the postgres role. The explicit REVOKE
-- overrides the default-grant.
--
-- This migration ships two safeguards:
--
-- 1. Idempotent re-affirm of the f07d4bb7 ACL state. Supabase staging
--    branches start data-empty (feedback_supabase_branch_data_empty.md),
--    and migrations replay against fresh schemas. Re-running f07d4bb7's
--    REVOKE here ensures the ACL state is part of the canonical migration
--    log rather than depending on a single point-in-time fix-up commit
--    being present.
--
-- 2. SCHEMA-QUICK-REFERENCE.md cross-reference. The pg_default_acl gotcha
--    is documented in the same commit (§32 RPC Functions — ACL conventions
--    note). OPS-43 tracks the broader pg_default_acl audit + tightening
--    migration (forward-looking).
--
-- Effect: zero schema-shape change; permission-only DDL. Idempotent — REVOKE
-- on an already-revoked grant is a no-op. Defensive exception handler skips
-- silently if the function is not yet present (fresh-DB ordering safety).
--
-- Source: kh-prod-readiness-S15 main-track merge close-out, Liam Option C
-- ratification (`docs/audits/kh-production-readiness-phase-1/STATUS-change-log.md`
-- S15 row).

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.list_public_tables() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.list_public_tables() FROM anon;
EXCEPTION
  WHEN undefined_function THEN
    -- Function not present on this branch yet (fresh DB before s13_followups
    -- replays). Skip silently; the canonical REVOKEs will fire alongside
    -- the CREATE in s13_followups + revoke_list_public_tables_from_public
    -- + revoke_list_public_tables_from_anon migrations.
    NULL;
END;
$$;
