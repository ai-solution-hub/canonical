-- =============================================================================
-- ID-120 {120.9} — api Data API surface: expose q_a_pair_dedup_proposals.
-- =============================================================================
--
-- Incremental forward add of the `api` INVOKER view for public.q_a_pair_dedup_proposals
-- (the {120.5} cross-workspace dedup-proposal store). The ID-115 generator
-- (scripts/generate-api-views.ts) emits to a FIXED-timestamp OUTPUT_FILE
-- (20260623140000_id115_api_views_and_rpcs.sql) already applied to hosted DBs, so an
-- incremental table-add cannot ride a regen of that file on an already-migrated DB — it
-- ships here as a forward migration in the EXACT generator idiom (DROP/CREATE
-- security_invoker view + INV-10 least-privilege grants). q_a_pair_dedup_proposals is also
-- added to the generator's SURFACE_TABLES allowlist so the next full generator run folds
-- this view into the canonical OUTPUT_FILE byte-identically.
--
-- Why this unblocks {120.7}/{120.8}: under ID-115 the public schema is UNEXPOSED via
-- PostgREST (PGRST106). The only Data API path to the proposal store is this api view —
-- the curator approve/reject API ({120.7}) and UI ({120.8}) read/update through `api`.
--
-- Security: the base table's RLS (admin/editor SELECT+UPDATE; no INSERT/DELETE policy) is
-- the real gate; the view is `security_invoker = true`, so RLS applies through it. anon is
-- capped at SELECT per INV-10 (and RLS still denies any non-admin/editor). This mirrors the
-- api.q_a_pairs view grant shape exactly (the base table carries the repo-standard ALTER
-- DEFAULT PRIVILEGES {S,I,U,D} for anon+authenticated, intersected per INV-10).

SET search_path = public, extensions;

-- q_a_pair_dedup_proposals ───────────────────────────────────────────────
DROP VIEW IF EXISTS api.q_a_pair_dedup_proposals;
CREATE VIEW api.q_a_pair_dedup_proposals WITH (security_invoker = true) AS
  SELECT
    id,
    pair_a_id,
    pair_b_id,
    similarity_score,
    proposed_survivor_id,
    survivor_reason,
    status,
    pair_a_source_workspace_id,
    pair_b_source_workspace_id,
    pair_a_source_form_response_id,
    pair_b_source_form_response_id,
    pair_a_fingerprint,
    pair_b_fingerprint,
    resolved_survivor_id,
    resolved_by,
    created_at,
    resolved_at
  FROM public.q_a_pair_dedup_proposals;
GRANT SELECT ON api.q_a_pair_dedup_proposals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_dedup_proposals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.q_a_pair_dedup_proposals TO service_role;
