-- =============================================================================
-- ID-22 — get_bid_question_stats_batch RETURN-shape rename + broken-body fix
-- =============================================================================
--
-- Scope: S250 WP2 — RPC return-column rename `project_id uuid` → `workspace_id uuid`
-- to align with T2 (S246) column rename `bid_questions.project_id → workspace_id`.
--
-- Critical finding (S250 W2 acceptance audit on prod rovrymhhffssilaftdwd):
--   `SELECT * FROM public.get_bid_question_stats_batch(ARRAY[]::uuid[]) LIMIT 1;`
--   on prod returns SQLSTATE 42703 — `column bq.project_id does not exist` —
--   confirming this RPC has been BROKEN on prod since T2 prod-apply (S247 W1).
--   T2's ALTER TABLE ... RENAME COLUMN does NOT rewrite LANGUAGE sql function
--   bodies that reference the renamed column; the function continued to
--   reference `bq.project_id` post-rename and erroring on every call.
--
-- Callers have been silently failing via fallback paths (per `app/api/procurement/
-- route.ts:90-95` fallback-to-per-bid logger.error branch); this migration
-- restores the batch RPC and renames the return column to `workspace_id` per
-- ID-22 backlog scope.
--
-- Parameter name preserved (`p_project_ids uuid[]`) — T2 carve-out documented
-- in `__tests__/validation/no-bid-regression-guard.test.ts` ALLOWLIST; DB
-- function parameter names are signature-stable for caller compatibility.
--
-- Changes vs prior shape:
--   * RETURNS TABLE: `project_id uuid` → `workspace_id uuid` (column 1 renamed).
--   * Body: `bq.project_id` → `bq.workspace_id` (3 sites: SELECT projection,
--     WHERE filter, GROUP BY).
--   * Other 8 return columns unchanged (total_questions + 7 count columns).
--
-- Sources of truth:
--   * docs/reference/product-backlog.json ID-22 (S248 WP2 Stage C surfaced;
--     S250 WP2 closes — adjust this reference after backlog edit).
--   * CLAUDE.md "Supabase auto-grants anon EXECUTE" gotcha (S250 W1b refined):
--     REVOKE FROM PUBLIC + REVOKE FROM anon + GRANT TO authenticated/service_role.
--   * docs/specs/0.9-canonical-pipeline/TECH.md P-40 + P-42 (no project_id refs).
--
-- Apply log:
--   * staging (turayklvaunphgbgscat): applied 2026-05-21 (S250 W2) — smoke green
--   * prod    (rovrymhhffssilaftdwd): applied 2026-05-21 (S250 W2) — smoke green
--

-- The `bid_questions.workspace_id` column lives in the public schema (no
-- extensions dep) — explicit search_path SET is defensive consistency with
-- S250 W1b precedent and avoids any LANGUAGE-sql definition-time resolution
-- surprises.
SET search_path = public, extensions;

-- Postgres does not allow CREATE OR REPLACE FUNCTION to change the return
-- type (RETURNS TABLE column names are part of the return type). The
-- column-1 rename project_id → workspace_id requires DROP + CREATE.
-- IF EXISTS handles re-apply idempotence on environments that may already
-- have been touched.
DROP FUNCTION IF EXISTS public.get_bid_question_stats_batch(uuid[]);

CREATE FUNCTION public.get_bid_question_stats_batch(p_project_ids uuid[])
RETURNS TABLE(
  workspace_id          uuid,
  total_questions       bigint,
  strong_match_count    bigint,
  partial_match_count   bigint,
  needs_sme_count       bigint,
  no_content_count      bigint,
  unmatched_count       bigint,
  drafted_count         bigint,
  complete_count        bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    bq.workspace_id,
    COUNT(*)::BIGINT AS total_questions,
    COUNT(*) FILTER (WHERE confidence_posture = 'strong_match')::BIGINT AS strong_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'partial_match')::BIGINT AS partial_match_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'needs_sme')::BIGINT     AS needs_sme_count,
    COUNT(*) FILTER (WHERE confidence_posture = 'no_content')::BIGINT    AS no_content_count,
    COUNT(*) FILTER (WHERE confidence_posture IS NULL)::BIGINT           AS unmatched_count,
    COUNT(*) FILTER (WHERE status = 'ai_drafted')::BIGINT                AS drafted_count,
    COUNT(*) FILTER (WHERE status = 'complete')::BIGINT                  AS complete_count
  FROM bid_questions bq
  WHERE bq.workspace_id = ANY(p_project_ids)
  GROUP BY bq.workspace_id;
$function$;

-- Ownership
ALTER FUNCTION public.get_bid_question_stats_batch(uuid[]) OWNER TO postgres;

-- RLS-PATTERN P-4: both REVOKEs (PUBLIC + anon) per CLAUDE.md S250 W1b
-- refinement. PUBLIC includes anon; pg_default_acl grants both directly.
REVOKE EXECUTE ON FUNCTION public.get_bid_question_stats_batch(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_bid_question_stats_batch(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_bid_question_stats_batch(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_bid_question_stats_batch(uuid[]) IS
  'ID-22 (S250 WP2) — batch question-stats aggregator. Returns one row per '
  'workspace_id (renamed from project_id S250 to align with T2 column rename). '
  'Parameter name `p_project_ids` preserved for caller signature stability '
  '(T2 carve-out per no-bid-regression-guard.test.ts ALLOWLIST). Pre-S250 '
  'function body referenced bq.project_id and silently errored on prod '
  'post-T2 (SQLSTATE 42703); this migration fixes both the broken body and '
  'the return-shape misalignment.';
