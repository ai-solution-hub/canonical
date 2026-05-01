-- ============================================================
-- S217 W1C — Widen get_filter_counts to publication_status='published'
-- ============================================================
-- §5.2 Phase 3 alignment follow-up to S216 W3
-- (20260430192325_widen_search_rpcs_visibility_filter.sql).
--
-- Background.
-- S216 W3 widened 8 production search RPCs to support a `visibility_filter`
-- param defaulting to 'default' (= `publication_status='published'`).
-- The W3 migration explicitly punted `get_filter_counts` to a follow-up
-- (W3 file lines 73-79: "used by browse filter sidebar; does NOT filter
-- on draft today, just `archived_at IS NULL`. If behaviour drift is
-- detected, file an OPS-NN backlog entry. This migration does NOT touch
-- them.").
--
-- S216 V_W3 verifier flagged the asymmetry. S217 W1C investigation
-- confirmed:
--   * `get_filter_counts` is consumed by `useFilterData` (browse filter
--     sidebar checkbox counts) and `useTopDomains` (browse cold-start
--     "Browse by domain" chip composite) — both user-facing surfaces.
--   * Browse search (`/api/search` → `hybrid_search`) and the chip-click
--     ingress route both return only `publication_status='published'`
--     under W3 default semantics.
--   * Pre-W1C: sidebar counts include drafts + in_review (because
--     `archived_at IS NULL` widens to {draft, in_review, published}),
--     so a user clicking a count-100 chip could see only ~60 results
--     post-search. This is real, observable count/result drift.
--
-- Decision: WIDEN to `publication_status='published'` to match the rest
-- of W3. Keeps the counts honest with what the user can actually see
-- via search. Surface risk: any item temporarily in `draft` or
-- `in_review` no longer contributes to its domain/content_type/platform
-- count until promoted to `published`. Accepted as the intended Phase 3
-- semantics (drafts are private-to-editor preview state, not browseable
-- inventory).
--
-- Schema invariant relied on (SCHEMA-QUICK-REF §1387):
--   `publication_status='archived' ↔ archived_at IS NOT NULL`
-- enforced by `enforce_archive_state_consistency` trigger. Switching
-- from `archived_at IS NULL` to `publication_status='published'` is
-- therefore a strict NARROWING — it cannot leak archived rows.
--
-- Anon access — REVOKE EXECUTE FROM anon.
-- Per `feedback_supabase_pg_default_acl_anon_execute`, every newly
-- recreated public.* function inherits an auto-grant of EXECUTE to anon
-- via `pg_default_acl`. W3 chose to preserve anon access on the 8
-- widened search RPCs to match its pre-existing baseline; W1C tightens
-- `get_filter_counts` (a metadata aggregation surface, not a search
-- entry point) to authenticated-only, consistent with the standard
-- post-S20-OPS feedback pattern. If browse counts must remain available
-- to anonymous viewers in future, restore the GRANT in a follow-up
-- migration with explicit access-control rationale.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_filter_counts();

CREATE OR REPLACE FUNCTION public.get_filter_counts()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN jsonb_build_object(
    'domain', COALESCE(
      (
        SELECT jsonb_object_agg(primary_domain, cnt)
        FROM (
          SELECT primary_domain, COUNT(*) AS cnt
          FROM content_items
          WHERE primary_domain IS NOT NULL
            AND publication_status = 'published'
          GROUP BY primary_domain
        ) d
      ),
      '{}'::jsonb
    ),
    'content_type', COALESCE(
      (
        SELECT jsonb_object_agg(content_type, cnt)
        FROM (
          SELECT content_type, COUNT(*) AS cnt
          FROM content_items
          WHERE content_type IS NOT NULL
            AND publication_status = 'published'
          GROUP BY content_type
        ) t
      ),
      '{}'::jsonb
    ),
    'platform', COALESCE(
      (
        SELECT jsonb_object_agg(platform, cnt)
        FROM (
          SELECT platform, COUNT(*) AS cnt
          FROM content_items
          WHERE platform IS NOT NULL
            AND publication_status = 'published'
          GROUP BY platform
        ) p
      ),
      '{}'::jsonb
    )
  );
END;
$$;

ALTER FUNCTION public.get_filter_counts() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.get_filter_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_filter_counts() TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_filter_counts() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_filter_counts() FROM PUBLIC;
