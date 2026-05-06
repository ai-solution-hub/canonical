-- ============================================================================
-- OPS-43.1 batch 3 — SECURITY DEFINER → SECURITY INVOKER (7 read-only RPCs)
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v4) §3.3.1.
-- Parent migrations:    20260502195036_ops43_1_secdef_to_invoker_batch_1.sql
--                       (kh-prod-readiness-S22 batch 1 — 10 stats getters)
--                       20260502232856_ops43_1_secdef_to_invoker_batch_2.sql
--                       (kh-prod-readiness-S22 batch 2 — 10 list/summary RPCs).
--                       This batch (S33-W2) closes 7 of the remaining 19
--                       SECDEF candidates from OPS-43.1.
--
-- Function search_path discipline — this migration alters existing functions
-- and does not CREATE new PL/pgSQL. The CLAUDE.md gotcha
-- ("All new PL/pgSQL functions MUST include SET search_path = public,
-- extensions") applies to function bodies, not to ALTER FUNCTION SECURITY
-- INVOKER toggles. The underlying functions retain their original
-- search_path settings (pg_proc.proconfig); this migration changes only
-- prosecdef. No proconfig changes are needed.
--
-- Background — OPS-43 IMPL closed the acute anon-exposure surface (REVOKE
-- pass) but left the durable SECDEF surface intact. Batches 1+2 closed 20
-- of the 39 candidates. Batch 3 (this migration) closes a further 7
-- read-only RPCs that share the batches 1+2 risk profile: pure SELECT
-- aggregators, all call-sites authenticated, target tables have
-- authenticated-SELECT RLS coverage.
--
-- One originally-listed candidate — `get_user_display_names(uuid[])` —
-- has been EXCLUDED from this batch and FLAGGED for Liam (escalation per
-- spec §3.3.1's "SECDEF wrapping is historical-only" precondition):
--
--   `get_user_display_names` reads `user_profiles` and `user_roles`.
--   `user_profiles` has TWO authenticated SELECT policies:
--     1. user_profiles_admin_select  qual = (get_user_role() IN
--                                            ('admin','editor'))
--     2. user_profiles_self_select   qual = (auth.uid() = id)
--   Effect under INVOKER: viewer-tier callers can only read THEIR OWN
--   profile row, not other users'. The function has authenticated call-
--   sites available to ALL tiers (app/api/users/display-names/route.ts
--   uses getAuthenticatedClient — viewers can call it). Flipping to
--   INVOKER WOULD CHANGE BEHAVIOUR: viewers would lose the ability to
--   resolve other users' display names. This is NOT historical-only
--   SECDEF wrapping — the SECDEF amplifier is actively required to
--   bypass the per-tier RLS predicate. Decision pending separate Liam
--   triage: either (a) keep SECDEF (legitimate), (b) introduce a
--   tier-agnostic RLS policy on user_profiles for display-name reads,
--   or (c) gate the route to admin/editor only. Out of scope for this
--   batch.
--
-- Batch 3 scope — 7 read-only RPCs:
--
--   1. get_guide_coverage             — guides × guide_sections × content_items
--                                       coverage matrix
--   2. get_item_workspaces            — per-item workspace lookup
--   3. get_items_with_quality_flags   — distinct content_item_ids with
--                                       unresolved ingestion-quality flags
--   4. get_tags_by_domain             — ai/user tag aggregator (with
--                                       internal auth.uid() guard)
--   5. get_topic_layers               — content_items grouped by layer for
--                                       a topic
--   6. hybrid_search                  — vector + lexical content search
--                                       (full-text + ANN + win-rate boost)
--   7. search_content_chunks          — vector search over content_chunks
--
-- Per-function triage (spec §3.3.1):
--
-- ─ Tables read (aggregate distinct, all 7 fns) ────────────────────────────
--   bid_questions, bid_responses, content_chunks, content_citations,
--   content_item_workspaces, content_items, guide_sections, guides,
--   ingestion_quality_log, layer_vocabulary, workspaces.
--
-- ─ RLS authenticated-SELECT coverage ──────────────────────────────────────
--   All 11 tables have RLS enabled with authenticated-role SELECT policies.
--   Nine of the policies have `qual = true` (tier-agnostic — admin/editor/
--   viewer all SELECT): bid_questions, bid_responses, content_chunks,
--   content_citations, content_item_workspaces, content_items,
--   ingestion_quality_log, layer_vocabulary, workspaces.
--
--   Two policies are non-trivial:
--   - guides:         qual = (is_published = true OR get_user_role()='admin')
--   - guide_sections: qual = EXISTS(guides g WHERE g.id = guide_id AND
--                            (g.is_published = true OR
--                             get_user_role() = 'admin'))
--   These affect `get_guide_coverage` only. The function's own WHERE
--   clause already filters `g.is_published = true` (line 21 of prosrc),
--   so under INVOKER the effective filter is unchanged for non-admins
--   (RLS narrows to the same predicate the function already requires)
--   and unchanged for admins (RLS opens to all guides, but the function
--   still only returns published — same as today). INVOKER preserves
--   access semantics for every tier, identical to batch 2's
--   `get_guide_content` analysis (same predicate shape).
--
-- ─ Call-site auth-channel verification ────────────────────────────────────
--   Every production call-site uses an authenticated channel:
--   - get_guide_coverage:           getAuthenticatedClient (app/api/guides),
--                                   getAuthorisedClient (coverage routes)
--   - get_item_workspaces:          getAuthenticatedClient
--                                   (app/api/items/[id]/workspaces)
--   - get_items_with_quality_flags: getAuthorisedClient (lib/reorient,
--                                   admin-gated isAdmin branch),
--                                   getAuthenticatedClient (browse hook)
--   - get_tags_by_domain:           internal `IF auth.uid() IS NULL THEN
--                                   RAISE` guard — works under INVOKER
--                                   identically to batch 1's
--                                   get_tag_counts_filtered (same pattern)
--   - get_topic_layers:             getAuthenticatedClient
--                                   (app/api/items/[id]/layers)
--   - hybrid_search:                createMcpClient(extra.authInfo) — JWT
--                                   bearer required (lib/mcp/auth.ts
--                                   throws if missing)
--   - search_content_chunks:        createMcpClient(extra.authInfo) — JWT
--                                   bearer required
--
--   `createMcpClient(extra.authInfo)` from lib/mcp/auth.ts requires a
--   bearer token (throws if missing) — JWT-gated, not anon. Identical
--   guarantee to batches 1+2.
--
-- Decision: all 7 candidates flip from SECDEF → INVOKER. SECDEF wrapping
-- was historical-only — every reader has authenticated-SELECT RLS
-- coverage on the table reads (true qual or matching predicate), and
-- every call-site uses an authenticated channel. INVOKER + existing RLS
-- preserves access semantics with no behaviour change for any signed-in
-- user.
--
-- Pattern — every ALTER wraps in DO $$ … $$ with WHEN undefined_function
-- THEN NULL exception handling so fresh-DB replay against partial schemas
-- (where a function may not exist yet) does not error. Mirrors batches
-- 1+2 exemplars verbatim.
--
-- Function signatures use pg_get_function_identity_arguments() output
-- verbatim (e.g. `vector, text, numeric, integer, boolean, character
-- varying`). None of the 7 candidates have multiple overloads in public
-- schema (verified via pre-flight pg_proc query — all returned single
-- rows by proname).
--
-- Smoke-call args used to validate per-function post-apply (executed by
-- IMPL author against staging immediately after MCP apply_migration):
--   1. get_guide_coverage             — no args (returns coverage matrix
--                                       rowset, possibly empty on data-
--                                       empty staging)
--   2. get_item_workspaces            — sample content_item_id (returns
--                                       workspace rowset, possibly empty)
--   3. get_items_with_quality_flags   — no args (returns content_item_id
--                                       array, possibly empty)
--   4. get_tags_by_domain             — 'ai' (returns domain×tag×count
--                                       rowset, possibly empty)
--   5. get_topic_layers               — sample topic_id (returns layer
--                                       rowset, possibly empty)
--   6. hybrid_search                  — zero-vector embedding + 'test'
--                                       text (returns rowset, possibly
--                                       empty)
--   7. search_content_chunks          — zero-vector embedding (returns
--                                       chunk rowset, possibly empty)
--
-- Verification — tail block runs the post-apply AC query and RAISES NOTICE
-- (not EXCEPTION) if any of the 7 candidate functions remains SECDEF.
-- Apply-safe (no transaction abort).
--
-- Future batches (OPS-43.1 batch 4+) will carry the remaining ~12 SECDEF
-- candidates — write-path RPCs and the user_profiles/user_roles read-path
-- RPCs that need separate RLS-policy decisions before INVOKER conversion.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §3.3.1 — Per-function ALTER FUNCTION ... SECURITY INVOKER
-- ----------------------------------------------------------------------------

-- 1. get_guide_coverage — reads guides + guide_sections + content_items.
--    guides + guide_sections RLS qual gates is_published=true OR admin;
--    function's own WHERE already filters is_published=true. INVOKER
--    preserves access semantics for every tier (matches batch 2's
--    get_guide_content analysis).
DO $$
BEGIN
  ALTER FUNCTION public.get_guide_coverage() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 2. get_item_workspaces — reads workspaces + content_item_workspaces (both
--    RLS authenticated-SELECT qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_item_workspaces(uuid) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 3. get_items_with_quality_flags — reads ingestion_quality_log +
--    content_items (both RLS authenticated-SELECT qual=true). SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_items_with_quality_flags() SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 4. get_tags_by_domain — reads content_items (RLS authenticated-SELECT
--    qual=true). Internal `IF auth.uid() IS NULL THEN RAISE` guard already
--    enforces JWT presence; works identically under INVOKER. Mirrors
--    batch 1's get_tag_counts_filtered. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_tags_by_domain(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 5. get_topic_layers — reads content_items + layer_vocabulary (both RLS
--    authenticated-SELECT qual=true). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.get_topic_layers(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 6. hybrid_search — reads content_items + content_citations + bid_responses
--    + bid_questions + workspaces (all RLS authenticated-SELECT qual=true).
--    Visibility filter (default/all/admin) is parameter-driven; INVOKER
--    does not alter that branch logic. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.hybrid_search(vector, text, numeric, integer, boolean, character varying) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 7. search_content_chunks — reads content_chunks + content_items (both
--    RLS authenticated-SELECT qual=true). Visibility filter is parameter-
--    driven. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.search_content_chunks(vector, numeric, integer, uuid, boolean, integer, character varying) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;


-- ============================================================================
-- §3.3.1 verification block (NOTICE-only; no transaction abort).
-- Expected v_remaining_secdef = 0 — all 7 candidates flipped to INVOKER.
-- (get_user_display_names excluded from this batch — see header note.)
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
      'get_guide_coverage',
      'get_item_workspaces',
      'get_items_with_quality_flags',
      'get_tags_by_domain',
      'get_topic_layers',
      'hybrid_search',
      'search_content_chunks'
    );

  IF v_remaining_secdef > 0 THEN
    RAISE NOTICE 'OPS-43.1 batch 3: % candidate functions still SECDEF (expected = 0)', v_remaining_secdef;
  END IF;
END
$$;


-- ============================================================================
-- AC verification (run separately post-apply, not as part of the migration
-- transaction). Across the 7 flipped functions, count must be 0:
--
--   SELECT count(*) FROM pg_proc
--   WHERE prokind='f' AND prosecdef
--     AND pronamespace = 'public'::regnamespace
--     AND proname IN ('get_guide_coverage','get_item_workspaces',
--                     'get_items_with_quality_flags','get_tags_by_domain',
--                     'get_topic_layers','hybrid_search',
--                     'search_content_chunks');
--
-- The original 8-function dispatch list (which included
-- get_user_display_names) returns 1 post-apply — get_user_display_names
-- remains SECDEF pending the separate Liam triage flagged in the header.
-- ============================================================================
