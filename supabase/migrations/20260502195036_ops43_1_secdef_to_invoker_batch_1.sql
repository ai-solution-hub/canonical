-- ============================================================================
-- OPS-43.1 batch 1 — SECURITY DEFINER → SECURITY INVOKER (10 stats getters)
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v3) §3.3.1.
-- Parent migration:     20260502143049_ops43_revoke_anon_execute_public_functions.sql
--                       (OPS-43 IMPL — revoked anon EXECUTE on the 43 SECDEF
--                       entries, leaving SECDEF wrapping in place pending
--                       this OPS-43.1 follow-up to flip to INVOKER where the
--                       SECDEF amplifier is historical-only.)
--
-- Background — OPS-43 IMPL closed the acute anon-exposure surface (REVOKE
-- pass) but left the durable SECDEF surface intact. Per spec §3.3.1, the
-- exit-ramp from "the SECDEF surface keeps growing" to "the SECDEF surface
-- only contains functions that legitimately need to bypass RLS" is a
-- discrete OPS-43.1 mini-WP that converts SECDEF→INVOKER for entries where
-- (a) all call-sites are authenticated channels (no anon RPC dependency),
-- AND (b) the function reads RLS-policied tables where the calling user
-- already has table-grant access through RLS — i.e. SECDEF wrapping is
-- historical-only, not actively required to bypass RLS for legitimate
-- access semantics.
--
-- Batch 1 scope — 10 read-only stats-getter functions (pure SELECT
-- aggregators, zero write side-effects), enumerated in the OPS-43 IMPL
-- commit body (be2d0cfb) as candidates:
--
--   1.  get_aggregate_win_rate_stats         — bid citation outcome aggregator
--   2.  get_bid_question_stats_batch         — per-project question status counts
--   3.  get_content_owner_stats              — owner-scoped freshness rollup
--   4.  get_content_win_rate                 — per-item win-rate aggregator
--   5.  get_dashboard_attention_counts       — multi-table dashboard counters
--   6.  get_quality_issue_counts             — open ingestion-quality flag counts
--   7.  get_review_breakdown_stats           — review-page breakdown JSON
--   8.  get_tag_counts_filtered              — tag-frequency paginated reader
--   9.  get_workspace_counts                 — workspace name → item count map
--   10. get_workspace_item_counts            — per-workspace item count + activity
--
-- Per-function triage (spec §3.3.1):
--
-- ─ Tables read (aggregate distinct, all 10 fns) ──────────────────────────
--   bid_questions, bid_responses, content_citations, content_item_workspaces,
--   content_items, ingestion_quality_log, notifications, source_documents,
--   taxonomy_subtopics, workspaces.
--
-- ─ RLS authenticated-SELECT coverage ─────────────────────────────────────
--   All 10 tables have RLS enabled with exactly one SELECT policy targeting
--   the `authenticated` role. Nine of the policies have `qual = true`
--   (tier-agnostic — admin/editor/viewer all SELECT). The tenth,
--   `notifications.notifications_select`, has
--   `qual = (user_id = (SELECT auth.uid()))` — only matters for
--   `get_dashboard_attention_counts(p_user_id, p_role)` whose
--   `WHERE user_id = p_user_id` clause is consistent with the RLS qual
--   because every production call-site (app/page.tsx, app/api/dashboard,
--   lib/mcp/resources.ts, lib/mcp/tools/dashboard.ts, lib/mcp/tools/apps.ts)
--   passes the calling user's own ID (auth.uid()), never another user's ID.
--   Confirmed by call-site grep 02/05/2026.
--
-- ─ Call-site auth-channel verification ───────────────────────────────────
--   Every production call-site uses an authenticated channel:
--   - get_aggregate_win_rate_stats:    getAuthorisedClient (admin/editor/viewer)
--   - get_bid_question_stats_batch:    getAuthorisedClient (passed-in client)
--   - get_content_owner_stats:         getAuthenticatedClient
--   - get_content_win_rate:            getAuthorisedClient + createMcpClient (JWT)
--   - get_dashboard_attention_counts:  getAuthorisedClient + createMcpClient (JWT)
--   - get_quality_issue_counts:        getAuthenticatedClient
--   - get_review_breakdown_stats:      getAuthorisedClient (admin/editor)
--   - get_tag_counts_filtered:         getAuthorisedClient + has internal
--                                      `IF auth.uid() IS NULL THEN RAISE`
--                                      guard — works under INVOKER + JWT.
--   - get_workspace_counts:            no production call-sites (defined-only)
--   - get_workspace_item_counts:       no production call-sites (defined-only)
--
--   `createMcpClient(extra.authInfo)` from lib/mcp/auth.ts requires a
--   bearer token (throws if missing) — JWT-gated, not anon.
--
-- Decision: all 10 candidates flip from SECDEF → INVOKER. SECDEF wrapping
-- was historical-only — every reader either has authenticated-SELECT RLS
-- coverage on the table reads (true qual) or operates on the calling
-- user's own row (notifications). INVOKER + existing RLS preserves access
-- semantics with no behaviour change for any signed-in user.
--
-- Pattern — every ALTER wraps in DO $$ … $$ with WHEN undefined_function
-- THEN NULL exception handling so fresh-DB replay against partial schemas
-- (where a function may not exist yet) does not error. Mirrors OPS-43 IMPL
-- exemplar 20260502143049_ops43_revoke_anon_execute_public_functions.sql
-- §3.5 trigger-function pattern lines 36-40.
--
-- Function signatures use pg_get_function_identity_arguments() output
-- verbatim (e.g. `text[], text` not `varchar[], varchar`); overloads
-- distinguished by full arg list. None of the 10 candidates have multiple
-- overloads in public schema.
--
-- Verification — tail block runs the post-apply AC query and RAISES NOTICE
-- (not EXCEPTION) if any of the 10 candidate functions remains SECDEF.
-- Apply-safe (no transaction abort).
--
-- Future batches (OPS-43.1 batch 1b+) carry the remaining ~29 SECDEF
-- candidates by access-pattern similarity — write-path RPCs and SECDEF
-- entries with non-trivial RLS coverage gaps need separate triage.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §3.3.1 — Per-function ALTER FUNCTION ... SECURITY INVOKER
-- ----------------------------------------------------------------------------

-- 1. get_aggregate_win_rate_stats — reads content_citations + content_items +
--    bid_responses + bid_questions + workspaces (all RLS authenticated-SELECT
--    qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_aggregate_win_rate_stats() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 2. get_bid_question_stats_batch — reads bid_questions (RLS authenticated-
--    SELECT qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_bid_question_stats_batch(uuid[]) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 3. get_content_owner_stats — reads content_items (RLS authenticated-SELECT
--    qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_content_owner_stats() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 4. get_content_win_rate — reads content_citations + bid_responses +
--    bid_questions + workspaces (all RLS authenticated-SELECT qual=true).
--    SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_content_win_rate(uuid) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 5. get_dashboard_attention_counts — reads content_items + ingestion_quality_log +
--    notifications + taxonomy_subtopics. All have RLS authenticated-SELECT;
--    notifications policy is `user_id = auth.uid()` which matches the
--    function's `WHERE user_id = p_user_id` clause because every call-site
--    passes the calling user's own ID. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_dashboard_attention_counts(uuid, text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 6. get_quality_issue_counts — reads ingestion_quality_log + content_items
--    (both RLS authenticated-SELECT qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_quality_issue_counts() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 7. get_review_breakdown_stats — reads content_items + ingestion_quality_log +
--    source_documents (all RLS authenticated-SELECT qual=true). SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_review_breakdown_stats() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 8. get_tag_counts_filtered — reads content_items (RLS authenticated-SELECT
--    qual=true). Internal guard `IF auth.uid() IS NULL THEN RAISE` already
--    enforces JWT presence; works identically under INVOKER. SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_tag_counts_filtered(text, integer, text, integer, integer) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 9. get_workspace_counts — reads content_item_workspaces + workspaces (both
--    RLS authenticated-SELECT qual=true). No production call-sites at HEAD
--    (defined-only). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_workspace_counts() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 10. get_workspace_item_counts — reads workspaces + content_item_workspaces
--     (both RLS authenticated-SELECT qual=true). No production call-sites at
--     HEAD (defined-only). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_workspace_item_counts() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;


-- ============================================================================
-- §3.3.1 verification block (NOTICE-only; no transaction abort).
-- Expected v_remaining_secdef = 0 — all 10 candidates flipped to INVOKER.
-- ============================================================================

DO $$
DECLARE
  v_remaining_secdef integer;
BEGIN
  SELECT count(*) INTO v_remaining_secdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.prosecdef
    AND p.proname IN (
      'get_aggregate_win_rate_stats',
      'get_bid_question_stats_batch',
      'get_content_owner_stats',
      'get_content_win_rate',
      'get_dashboard_attention_counts',
      'get_quality_issue_counts',
      'get_review_breakdown_stats',
      'get_tag_counts_filtered',
      'get_workspace_counts',
      'get_workspace_item_counts'
    );

  IF v_remaining_secdef > 0 THEN
    RAISE NOTICE 'OPS-43.1 batch 1: % candidate functions still SECDEF (expected = 0)', v_remaining_secdef;
  END IF;
END
$$;
