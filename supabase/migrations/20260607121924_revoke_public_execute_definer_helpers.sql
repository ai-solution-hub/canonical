-- ID-87.2 (S321, Liam-ratified staging+prod): close the PUBLIC-inheritance EXECUTE
-- exposure on three SECURITY DEFINER helpers from 20260514150238.
--
-- Root cause (advisor-review-s321.md §3): that migration revoked EXECUTE FROM anon
-- only; PostgreSQL's implicit PUBLIC EXECUTE grant on functions means anon and
-- authenticated re-inherit the privilege through PUBLIC — the exact gotcha already
-- fixed for the T6 RPCs in 20260521095209 (and the pattern bl-231 documents:
-- anon-only REVOKE is insufficient wherever a PUBLIC grant survives).
--
-- grant_standard_public_table_access(regclass) executes GRANT DDL on an arbitrary
-- regclass as definer — the most serious of the S321 advisor findings. rls_auto_enable()
-- is the event-trigger helper (lower impact, same root cause). q_a_pairs_history_trigger()
-- is hygiene: trigger functions cannot be invoked directly, but the authenticated
-- EXECUTE grant is needless surface.
--
-- Pure REVOKEs — no function bodies altered, so no SET search_path directive applies.

REVOKE EXECUTE ON FUNCTION public.grant_standard_public_table_access(regclass) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_standard_public_table_access(regclass) FROM anon;
REVOKE EXECUTE ON FUNCTION public.grant_standard_public_table_access(regclass) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.q_a_pairs_history_trigger() FROM authenticated; -- hygiene
