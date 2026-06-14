-- =============================================================================
-- ID-59 {59.21} M1 (part 2 of 2) — route-i promotion eligibility RPC
-- =============================================================================
--
-- Scope: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
--        M1 + R1 step 1 (OQ-3 eligibility — CHANGE). Keeps the LEFT JOIN
--        server-side so the promote loop (R1) receives the exact eligible set.
--
-- Eligibility (OQ-3, self-healing): an extraction is eligible to (re)promote when
-- it is LIVE (invalidated_at IS NULL) AND EITHER
--   * unpromoted (promoted_to_pair_id IS NULL), OR
--   * linked-but-its-pair-is-unembedded (the pair exists but question_embedding
--     IS NULL) — so a transient embedding outage is retried on the next run
--     rather than stranded forever. The lineage link does NOT block retry.
-- Ordered by created_at for deterministic batching.
--
-- SECURITY INVOKER (PostgreSQL default — stated explicitly): the function runs as
-- the calling role so RLS on q_a_extractions / q_a_pairs applies. This differs
-- from the SECURITY DEFINER search RPCs (reference_search etc.) by design — route-i
-- promotion is an authorised operator/pipeline action that must stay RLS-scoped
-- (TECH R1 auth note: no service-role escalation, no cross-workspace read/write).
--
-- search_path = public, extensions: mandatory for all functions (CLAUDE.md
-- Supabase gotcha — unqualified type/operator resolution + injection hardening).
--
-- RLS-PATTERN P-4 (REVOKE co-located with CREATE — migration-revoke-guard.yml
-- enforces this in the SAME migration as the CREATE):
--   pg_default_acl auto-grants EXECUTE to anon on every new public.* function, and
--   REVOKE FROM PUBLIC alone is a no-op against the anon role (pg_default_acl
--   precedence). An explicit REVOKE FROM anon is required. We also REVOKE FROM
--   PUBLIC (the built-in CREATE FUNCTION default grants EXECUTE to PUBLIC) and
--   GRANT to authenticated + service_role.
--
-- No new column — question_embedding, promoted_to_pair_id, invalidated_at all
-- already exist (20260520225456_t6_q_a_pairs_full_schema.sql).
--
-- Apply log:
--   * 2026-06-14 — applied to staging (turayklvaunphgbgscat) via supabase db push.
--   * PROD push GATED — do NOT push to prod from this subtask.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.q_a_extractions_promotion_candidates()
RETURNS SETOF public.q_a_extractions
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT e.*
  FROM public.q_a_extractions e
  LEFT JOIN public.q_a_pairs p ON p.id = e.promoted_to_pair_id
  WHERE e.invalidated_at IS NULL
    AND (
      e.promoted_to_pair_id IS NULL
      OR (p.id IS NOT NULL AND p.question_embedding IS NULL)
    )
  ORDER BY e.created_at;
$$;

-- RLS-PATTERN P-4: explicit REVOKE from anon + PUBLIC, then GRANT to the
-- authorised roles. Co-located with CREATE in this migration.
REVOKE EXECUTE ON FUNCTION public.q_a_extractions_promotion_candidates() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.q_a_extractions_promotion_candidates() FROM anon;
GRANT EXECUTE ON FUNCTION public.q_a_extractions_promotion_candidates() TO authenticated, service_role;
