-- ============================================================================
-- OPS-43.1 batch 2 — SECURITY DEFINER → SECURITY INVOKER (10 read-only RPCs)
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v3) §3.3.1.
-- Parent migration:     20260502195036_ops43_1_secdef_to_invoker_batch_1.sql
--                       (kh-prod-readiness-S22 batch 1 — 10 stats getters
--                       flipped INVOKER; this batch continues by access-pattern
--                       similarity per backlog OPS-43.1 commit `be2d0cfb`.)
--
-- Background — OPS-43 IMPL closed the acute anon-exposure surface (REVOKE
-- pass) but left the durable SECDEF surface intact. OPS-43.1 batch 1 closed
-- 10 of the 39 candidates. Batch 2 (this migration) closes a further 10
-- read-only stats/list helpers that share batch 1's risk profile: pure
-- SELECT aggregators, all call-sites authenticated, target tables have
-- authenticated-SELECT RLS coverage. Remaining ~19 candidates wait for
-- batch 3-4 (write-path RPCs and SECDEF entries with non-trivial RLS
-- coverage gaps need separate triage).
--
-- Batch 2 scope — 10 read-only list/summary/lookup RPCs:
--
--   1.  get_bid_summary                  — bid project rollup JSON
--   2.  get_coverage_matrix              — taxonomy × freshness aggregator
--   3.  get_document_version_chain       — recursive parent_id walk on docs
--   4.  get_entity_co_occurrence         — entity_mentions self-join pairs
--   5.  get_entity_list_aggregated       — entity admin paged list
--   6.  get_entity_name_counts           — top-50 mention frequency
--   7.  get_entity_relationships_rpc     — entity → relationships fuzzy lookup
--   8.  get_entity_summary               — entity + related-entities aggregator
--   9.  get_grouped_activity_feed        — dashboard activity grouping
--   10. get_guide_content                — guide section × content join
--
-- Per-function triage (spec §3.3.1):
--
-- ─ Tables read (aggregate distinct, all 10 fns) ──────────────────────────
--   bid_questions, bid_responses, content_history, content_items,
--   entity_mentions, entity_relationships, guide_sections, guides,
--   ingestion_quality_log, source_documents, taxonomy_domains,
--   taxonomy_subtopics.
--
-- ─ RLS authenticated-SELECT coverage ─────────────────────────────────────
--   All 12 tables have RLS enabled with exactly one SELECT policy targeting
--   the `authenticated` role. Ten of the policies have `qual = true`
--   (tier-agnostic — admin/editor/viewer all SELECT). The remaining two —
--   `guides."Authenticated users can read guides"` and
--   `guide_sections."Authenticated users can read guide sections"` —
--   gate visibility on `is_published = true OR get_user_role() = 'admin'`
--   (sections inherit via EXISTS predicate on `guides`). This affects
--   `get_guide_content(p_guide_slug)` only. The route call-site
--   (app/api/guides/[slug]/route.ts) already executes a separate
--   `from('guides').select().eq('slug').single()` BEFORE invoking the RPC,
--   which is itself RLS-gated by the same predicate — non-admins fetching
--   an unpublished guide already receive 404 at that earlier query, never
--   reaching the RPC. INVOKER preserves access semantics: the RPC simply
--   sees the same row-set the caller already proved access to.
--
-- ─ Call-site auth-channel verification ───────────────────────────────────
--   Every production call-site uses an authenticated channel:
--   - get_bid_summary:                   defined-only (no production callers)
--   - get_coverage_matrix:               getAuthenticatedClient + getAuthorisedClient
--   - get_document_version_chain:        createServiceClient (RLS-bypass)
--                                        + createMcpClient (JWT — MCP tool)
--   - get_entity_co_occurrence:          getAuthenticatedClient
--   - get_entity_list_aggregated:        getAuthorisedClient(['admin'])
--   - get_entity_name_counts:            defined-only (no production callers)
--   - get_entity_relationships_rpc:      createMcpClient (JWT — MCP tool)
--   - get_entity_summary:                createClient (browser JWT) +
--                                        createMcpClient (JWT — MCP tool)
--   - get_grouped_activity_feed:         getAuthorisedClient (dashboard)
--   - get_guide_content:                 getAuthenticatedClient
--
--   `createMcpClient(extra.authInfo)` from lib/mcp/auth.ts requires a
--   bearer token (throws if missing) — JWT-gated, not anon.
--   `createServiceClient` from lib/supabase/server.ts uses service-role
--   which bypasses RLS entirely; INVOKER under service-role is identical
--   to SECDEF under any role for table-read access.
--
-- Decision: all 10 candidates flip from SECDEF → INVOKER. SECDEF wrapping
-- was historical-only — every reader either has authenticated-SELECT RLS
-- coverage on the table reads (true qual) or operates under an existing
-- gate that already enforces the same predicate at the route layer
-- (`get_guide_content`). INVOKER + existing RLS preserves access semantics
-- with no behaviour change for any signed-in user.
--
-- Pattern — every ALTER wraps in DO $$ … $$ with WHEN undefined_function
-- THEN NULL exception handling so fresh-DB replay against partial schemas
-- (where a function may not exist yet) does not error. Mirrors batch 1
-- exemplar 20260502195036_ops43_1_secdef_to_invoker_batch_1.sql.
--
-- Function signatures use pg_get_function_identity_arguments() output
-- verbatim. None of the 10 candidates have multiple overloads in public
-- schema.
--
-- Smoke-call args used to validate per-function post-apply (documented
-- inline beside each ALTER):
--   1.  get_bid_summary               — random uuid (returns empty JSON shape)
--   2.  get_coverage_matrix           — NULL (full taxonomy, no layer filter)
--   3.  get_document_version_chain    — random uuid (returns empty rowset)
--   4.  get_entity_co_occurrence      — defaults (limit=20, min=2, type=NULL)
--   5.  get_entity_list_aggregated    — defaults (limit=50, offset=0)
--   6.  get_entity_name_counts        — no args
--   7.  get_entity_relationships_rpc  — '__nonexistent__' (returns empty rowset)
--   8.  get_entity_summary            — defaults (limit=NULL → no cap)
--   9.  get_grouped_activity_feed     — defaults (limit=10, is_admin=false)
--   10. get_guide_content             — '__nonexistent__' (returns empty rowset)
--
-- Verification — tail block runs the post-apply AC query and RAISES NOTICE
-- (not EXCEPTION) if any of the 10 candidate functions remains SECDEF.
-- Apply-safe (no transaction abort).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §3.3.1 — Per-function ALTER FUNCTION ... SECURITY INVOKER
-- ----------------------------------------------------------------------------

-- 1. get_bid_summary — reads bid_questions + bid_responses (both RLS
--    authenticated-SELECT qual=true). RLS policies: `bid_questions_select`,
--    `bid_responses_select`. Defined-only (no production callers at HEAD).
--    SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_bid_summary(uuid) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 2. get_coverage_matrix — reads taxonomy_domains + taxonomy_subtopics +
--    content_items (all RLS authenticated-SELECT qual=true). RLS policies:
--    `taxonomy_domains_select`, `taxonomy_subtopics_select`,
--    `content_items_select`. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_coverage_matrix(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 3. get_document_version_chain — recursive CTE over source_documents +
--    counts content_items rows by source_document_id. RLS policies:
--    `Authenticated users can view source documents` (qual=true) and
--    `content_items_select` (qual=true). Production caller uses
--    createServiceClient (RLS-bypass), so INVOKER is a no-op for that
--    path; MCP caller uses createMcpClient (JWT) which gets full
--    authenticated-SELECT visibility. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_document_version_chain(uuid) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 4. get_entity_co_occurrence — reads entity_mentions only (RLS
--    authenticated-SELECT qual=true). RLS policy:
--    `Authenticated users can view entity mentions`. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_entity_co_occurrence(integer, integer, text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 5. get_entity_list_aggregated — reads entity_mentions + entity_relationships
--    (both RLS authenticated-SELECT qual=true). RLS policies:
--    `Authenticated users can view entity mentions`,
--    `Authenticated users can view entity relationships`. Route caller
--    enforces admin role at the application layer
--    (getAuthorisedClient(['admin'])); INVOKER does not weaken that gate.
--    SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_entity_list_aggregated(text, text, boolean, boolean, integer, integer) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 6. get_entity_name_counts — reads entity_mentions (RLS authenticated-SELECT
--    qual=true). RLS policy: `Authenticated users can view entity mentions`.
--    Defined-only (no production callers at HEAD). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_entity_name_counts() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 7. get_entity_relationships_rpc — reads entity_relationships only (RLS
--    authenticated-SELECT qual=true). RLS policy:
--    `Authenticated users can view entity relationships`. SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_entity_relationships_rpc(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 8. get_entity_summary — reads entity_mentions + entity_relationships (both
--    RLS authenticated-SELECT qual=true). RLS policies:
--    `Authenticated users can view entity mentions`,
--    `Authenticated users can view entity relationships`. SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_entity_summary(text, text, integer) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 9. get_grouped_activity_feed — reads content_history + ingestion_quality_log
--    (both RLS authenticated-SELECT qual=true). RLS policies:
--    `content_history_select`, `quality_log_select`. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_grouped_activity_feed(integer, boolean, timestamp with time zone) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 10. get_guide_content — reads guide_sections + guides + content_items.
--     RLS policies: `Authenticated users can read guide sections` and
--     `Authenticated users can read guides` both gate on
--     `is_published = true OR get_user_role() = 'admin'`; `content_items`
--     `content_items_select` is qual=true. The route call-site
--     (app/api/guides/[slug]/route.ts) already runs a separate
--     `from('guides').select().eq('slug').single()` BEFORE invoking this
--     RPC, which is itself RLS-gated by the same predicate — non-admin
--     callers fetching an unpublished guide already receive 404 at the
--     earlier query and never reach the RPC. INVOKER preserves access
--     semantics: the RPC simply sees the same row-set the caller has
--     already been authorised against. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_guide_content(text) SECURITY INVOKER;
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
      'get_bid_summary',
      'get_coverage_matrix',
      'get_document_version_chain',
      'get_entity_co_occurrence',
      'get_entity_list_aggregated',
      'get_entity_name_counts',
      'get_entity_relationships_rpc',
      'get_entity_summary',
      'get_grouped_activity_feed',
      'get_guide_content'
    );

  IF v_remaining_secdef > 0 THEN
    RAISE NOTICE 'OPS-43.1 batch 2: % candidate functions still SECDEF (expected = 0)', v_remaining_secdef;
  END IF;
END
$$;
