-- ID-131.19 S450 GO — targeted anon-EXECUTE revoke: q_a_extractions_promotion_candidates.
--
-- The {59.21} ratified posture (RLS-PATTERN P-4) denies anon EXECUTE on the
-- promotion-eligibility RPC, and promotion-idempotency.integration.test.ts
-- asserts it. The S450 M-API whole-surface regen (20260706150000) emitted
-- `GRANT EXECUTE ... TO anon, authenticated, service_role` for the api wrapper
-- because the generator mirrors the BASE fn's live ACL — and the base fn
-- carried pre-existing anon drift (INV-20 class; see the S450 131.19 journal).
-- This migration restores the ratified posture for THIS fn only; the
-- platform-wide sweep + generator-template fix is {61.14} (DR-035).
REVOKE EXECUTE ON FUNCTION public.q_a_extractions_promotion_candidates() FROM anon;
REVOKE EXECUTE ON FUNCTION api.q_a_extractions_promotion_candidates() FROM anon;
