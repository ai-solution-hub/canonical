-- ============================================================================
-- OPS-43 §3 — Repo-wide REVOKE EXECUTE … FROM anon on public.* functions
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v2, S20-ratified).
-- Companion migration:  20260502143054_ops43_tighten_pg_default_acl.sql
--                       MUST land in the same wave (§3-then-§4 lock per §4.5).
--
-- Background — Supabase pre-seeds pg_default_acl for object_type='f' in
-- schema public so every postgres-owned function created inherits an
-- explicit GRANT EXECUTE to anon. The pre-squash baseline also issued
-- explicit `GRANT ALL ON FUNCTION public.<fn> TO anon, authenticated,
-- service_role` for every function, which (per PG semantics) materialised
-- the implicit PUBLIC EXECUTE grant explicitly in proacl. As a result,
-- REVOKE EXECUTE … FROM anon alone is insufficient — anon retains
-- EXECUTE via PUBLIC inheritance until PUBLIC is also revoked. This
-- migration revokes from BOTH PUBLIC AND anon for every NEEDS-REVOKE
-- entry, closing the existing exposure surface across all 102 public.*()
-- functions; the §4 companion tightens pg_default_acl so future CREATE
-- FUNCTION in public no longer auto-grants anon.
--
-- IMPL deviation from spec §3.2 — spec template was `FROM anon;` only.
-- IMPL author confirmed empirically (post first-apply) that this leaves
-- PUBLIC grant intact and `has_function_privilege('anon', …)` still
-- returns TRUE via inheritance. Pattern corrected to `FROM PUBLIC, anon;`
-- for non-trigger entries, matching the canonical exemplar
-- 20260429152221_post_s14_acl_alignment.sql which revokes from both.
--
-- Live cross-check ran 02/05/2026 against rovrymhhffssilaftdwd
-- (production) and turayklvaunphgbgscat (persistent staging branch). All
-- function signatures in this migration use pg_get_function_identity_arguments()
-- output verbatim so REVOKE statements match the live argument lists
-- (overloads distinguished by full arg list).
--
-- Pattern — every REVOKE wraps in DO $$ … $$ with WHEN undefined_function
-- THEN NULL exception handling so fresh-DB replay against partial schemas
-- (where a function may not exist yet) does not error. Verbatim spec §3.2.
--
-- Trigger functions (RETURNS trigger) — REVOKE additionally from PUBLIC
-- and authenticated. service_role + postgres retain (trigger fires via
-- owner; service_role bypasses RLS). No legitimate RPC use case at any
-- auth tier. Verbatim spec §3.5.
--
-- SECDEF triage decision (per spec §3.3 protocol) — IMPL author ran
-- `grep -rn "rpc(['\"]<fn>" lib/ app/ scripts/ components/ contexts/
-- hooks/ __tests__/` for all 44 SECDEF entries (43 NEEDS-PER-TENANT-REVIEW
-- + set_config). Every call-site uses an authenticated channel:
--   * createServiceClient() — service_role channel, REVOKE anon safe.
--   * getAuthorisedClient() / getAuthenticatedClient() — JWT-gated route
--     (proxy.ts publicRoutes = ['/login','/auth/callback','/oauth/consent']
--     only — none call any RPC), REVOKE anon safe.
--   * createClient() in components — browser client whose @supabase/ssr
--     session attaches the user JWT once signed in; pages that use these
--     hooks all gate on auth.
-- Decision: REVOKE anon from 43 of 44 SECDEF entries. set_config retained
-- as intentional-anon (PostgREST session-config wrapper; pre-squash GRANT
-- at line 7821 verified live as anon=X/postgres EXECUTE-only). All 43
-- REVOKE'd SECDEF entries flagged for OPS-43.1 — every one is wrapping a
-- read of an RLS-policied table where the calling user already has
-- table-level grants, so SECDEF is historical-only.
--
-- Verification — tail block runs the AC-1 cross-check post-apply and
-- RAISES NOTICE (not EXCEPTION) if more than v_expected_remaining
-- functions remain anon-exposed. v_expected_remaining = 1 — only
-- set_config retained intentional-anon. The 8 KEEP-as-is entries per
-- spec §2.3 also got their PUBLIC inheritance broken by the
-- `FROM PUBLIC, anon` pattern (spec-template correction; see commit
-- body), tightening 7 of them further than the spec's `FROM anon`
-- alone would have.
--
-- The pgvector extension lives in the `extensions` schema (not `public`),
-- so signatures referencing the vector type are written as
-- `extensions.vector` rather than bare `vector`. The CLI psql wrapper
-- runs with a strict search_path that excludes extensions; schema-
-- qualifying is the safe, explicit form.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §3.1 Group 1 — Pre-squash trigger functions (10 entries from §2.4.1, T)
-- Pattern: REVOKE EXECUTE … FROM PUBLIC, anon, authenticated (spec §3.5).
-- ----------------------------------------------------------------------------

-- auto_version_content_history: trigger fn, not RPC-callable.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.auto_version_content_history() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- bid_response_auto_version: trigger fn.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.bid_response_auto_version() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- coerce_null_token_columns: trigger fn (SECDEF).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.coerce_null_token_columns() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- content_history_auto_version: trigger fn.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.content_history_auto_version() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- set_classification_disputes_updated_at: trigger fn.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.set_classification_disputes_updated_at() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- snapshot_bid_response_history: trigger fn (SECDEF).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.snapshot_bid_response_history() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- sync_bid_status_to_jsonb: trigger fn.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.sync_bid_status_to_jsonb() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- update_citation_count: trigger fn (SECDEF).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.update_citation_count() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- update_updated_at_column: trigger fn.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- validate_layer_key: trigger fn (SECDEF).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.validate_layer_key() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3.1 Group 2 — Pre-squash NEEDS-REVOKE-internal non-trigger (4 entries)
-- Pipeline service-role-only or admin-only ops. Pattern: REVOKE … FROM anon.
-- (authenticated retained — even though no current call-site exists, an
-- internal admin route may call these in future.)
-- ----------------------------------------------------------------------------

-- claim_next_job: pipeline service-role only (scripts/bid_worker.py uses service-role).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.claim_next_job() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- cleanup_filtered_articles (SECDEF): cron route uses createServiceClient (service-role).
-- SECDEF triage: createServiceClient() in app/api/cron/intelligence-cleanup/route.ts:17 — service_role, REVOKE anon safe.
-- OPS-43.1 candidate: SECDEF wrapping is historical-only — service-role bypasses RLS already.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.cleanup_filtered_articles() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_due_feed_sources(max_sources integer): pipeline service-role only.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_due_feed_sources(max_sources integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- recalculate_all_freshness: service-role batch (app/api/freshness/recalculate-all/route.ts uses authenticated client; safe to revoke anon).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.recalculate_all_freshness() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3.1 Group 3 — Pre-squash NEEDS-REVOKE-keep-authenticated (37 entries)
-- RPC-callable but only by signed-in users. Pattern: REVOKE … FROM anon.
-- authenticated grant intact (verified live).
-- ----------------------------------------------------------------------------

-- check_content_exists(ids uuid[]): used by lib/citations.ts via authenticated client.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.check_content_exists(ids uuid[]) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- delete_tag(p_tag text, p_type text): admin-only RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.delete_tag(p_tag text, p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- filter_by_keywords(keyword_list text[], match_mode text): browse RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.filter_by_keywords(keyword_list text[], match_mode text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- filter_by_keywords(search_terms text[]): browse RPC overload.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.filter_by_keywords(search_terms text[]) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_duplicate_pairs(similarity_threshold numeric, p_domain text, limit_count integer): admin dedup.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_duplicate_pairs(similarity_threshold numeric, p_domain text, limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer): item-detail page.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_related_items(p_item_id uuid, p_similarity_threshold double precision, p_limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_similar_content(query_embedding extensions.vector, similarity_threshold double precision, limit_count integer): search overload.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_similar_content(query_embedding extensions.vector, similarity_threshold double precision, limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_similar_content(query_embedding extensions.vector, similarity_threshold numeric, limit_count integer): search overload.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_similar_content(query_embedding extensions.vector, similarity_threshold numeric, limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_all_tag_counts: filter-counts RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_all_tag_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_audit_content_items(p_domain text, p_limit integer): admin audit RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_audit_content_items(p_domain text, p_limit integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_author_analysis(p_author_name text): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_author_analysis(p_author_name text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_bid_question_stats(p_project_id uuid): bid stats.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_bid_question_stats(p_project_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_capture_activity(days_back integer): dashboard RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_capture_activity(days_back integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_content_gaps: coverage RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_content_gaps() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_coverage_summary: coverage summary.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_coverage_summary() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_domain_subtopic_counts: filter RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_domain_subtopic_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_filter_counts: filter RPC. (NOTE: live state already shows anon=false — this is a no-op safety re-affirm.)
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_filter_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer): workspace analytics.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_filter_ratio_trend(p_workspace_id uuid, p_granularity text, p_period_days integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_freshness_breakdown: coverage RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_freshness_breakdown() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_popular_keywords(p_limit integer): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_popular_keywords(p_limit integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_reading_patterns(p_days integer): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_reading_patterns(p_days integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_source_documents: source-doc list RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_source_documents() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_template_summary(p_template_id uuid): templates RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_template_summary(p_template_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_top_authors(p_limit integer): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_top_authors(p_limit integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_topic_deep_dive(p_keyword text): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_topic_deep_dive(p_keyword text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_trend_analysis(p_days integer, p_min_count integer): analytics RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_trend_analysis(p_days integer, p_min_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_unique_authors: filter RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_unique_authors() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_user_tag_counts: filter RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_user_tag_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_verification_stats: coverage RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_verification_stats() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- merge_item_metadata(p_item_id uuid, p_new_data jsonb): item update RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.merge_item_metadata(p_item_id uuid, p_new_data jsonb) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- merge_tags(p_source text, p_target text, p_type text): tag admin RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.merge_tags(p_source text, p_target text, p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- rename_tag(p_old text, p_new text, p_type text): tag admin RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.rename_tag(p_old text, p_new text, p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- search_content(query_embedding extensions.vector, similarity_threshold double precision, limit_count integer): search overload.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.search_content(query_embedding extensions.vector, similarity_threshold double precision, limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- search_content(query_embedding extensions.vector, similarity_threshold numeric, limit_count integer): search overload.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.search_content(query_embedding extensions.vector, similarity_threshold numeric, limit_count integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- search_for_bid_response — live signature includes visibility_filter character varying (S216 W3).
-- Spec §2.4.1 shows older 4-arg signature; live state used per IMPL brief.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.search_for_bid_response(query_embedding extensions.vector, query_text text, limit_count integer, include_superseded boolean, visibility_filter character varying) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- suggest_tags(p_prefix text, p_type text): tag suggest RPC.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.suggest_tags(p_prefix text, p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- toggle_star(item_id uuid): older overload, not in current code paths but still present.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.toggle_star(item_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3.1 Group 4a — Pre-squash NEEDS-PER-TENANT-REVIEW SECDEF triage REVOKE (36 entries)
-- All call-sites verified authenticated; safe to REVOKE anon. Each row
-- carries an inline comment noting call-sites + auth tier per spec §3.3.
-- ----------------------------------------------------------------------------

-- bulk_assign_content_owner: app/api/content-owners/bulk-assign/route.ts uses authenticated client.
-- OPS-43.1 candidate: SECDEF wrapping — RLS already gates content_items.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.bulk_assign_content_owner(p_item_ids uuid[], p_owner_id uuid, p_assigned_by uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- bulk_delete_tags: app/api/tags/bulk-delete/route.ts uses getAuthorisedClient(['admin']).
-- OPS-43.1 candidate: SECDEF historical-only.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.bulk_delete_tags(p_tags text[], p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- bulk_merge_tags: app/api/tags/bulk-merge/route.ts uses getAuthorisedClient(['admin']).
-- OPS-43.1 candidate: SECDEF historical-only.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.bulk_merge_tags(p_sources text[], p_target text, p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- delete_duplicate_entity_mentions: no call-sites (admin entity merge utility).
-- REVOKE anon safe; OPS-43.1 candidate (latent SECDEF, no current callers).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.delete_duplicate_entity_mentions(p_canonical_name text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- detect_reupload: pipeline ingest path; only test fixtures use rpc(...) directly.
-- Pipeline uses service_role; REVOKE anon safe. OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.detect_reupload(p_filename text, p_uploaded_by uuid, p_content_hash text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_duplicate_tags: app/api/tags/duplicates/route.ts uses getAuthorisedClient.
-- OPS-43.1 candidate: SECDEF historical-only.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_duplicate_tags(p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- find_exact_duplicates: lib/dedup.ts caller passes supabase client from authenticated context.
-- OPS-43.1 candidate: SECDEF historical-only.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.find_exact_duplicates(p_content_hash text, p_exclude_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_aggregate_win_rate_stats: app/api/analytics/win-rate/route.ts uses getAuthorisedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_aggregate_win_rate_stats() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_bid_question_stats_batch: lib/bid/bid-queries.ts via authenticated supabase param.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_bid_question_stats_batch(p_project_ids uuid[]) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_bid_summary: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- bid_workspaces/bid_responses — both RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_bid_summary(bid_workspace_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_content_owner_stats: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- content_items/users — both RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_content_owner_stats() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_content_win_rate: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- bid_responses — RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_content_win_rate(p_content_item_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_coverage_matrix: app/api/coverage/route.ts uses getAuthenticatedClient; gaps route same.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_coverage_matrix(p_layer text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_dashboard_attention_counts: lib/dashboard.ts called from app/page.tsx + /api/dashboard, both auth-gated.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_dashboard_attention_counts(p_user_id uuid, p_role text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_document_version_chain: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- source_documents/source_document_versions — both RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_document_version_chain(p_document_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_entity_co_occurrence: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- entity_mentions — RLS-policied via content_items join).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_entity_co_occurrence(p_limit integer, p_min_count integer, p_entity_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_entity_list_aggregated: app/api/entities/route.ts uses getAuthorisedClient(['admin']).
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_entity_list_aggregated(p_type text, p_search text, p_variants_only boolean, p_type_conflicts boolean, p_limit integer, p_offset integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_entity_name_counts: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- entity_mentions — RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_entity_name_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_entity_relationships_rpc: no current call-sites; OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_entity_relationships_rpc(p_entity_name text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_entity_summary: hooks/browse/use-filter-data.ts uses getSupabase() (browser client; user JWT once signed in).
-- All callers auth-gated; REVOKE anon safe. OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_entity_summary(p_entity_name text, p_entity_type text, p_limit integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_grouped_activity_feed: lib/dashboard.ts (same auth chain as get_dashboard_attention_counts).
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_guide_content: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- guides/guide_sections — both RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_guide_content(p_guide_slug text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_guide_coverage: app/api/guides/route.ts + coverage routes use getAuthenticatedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_guide_coverage() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_item_workspaces: app/api/items/[id]/workspaces/route.ts uses getAuthenticatedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_item_workspaces(p_item_id uuid) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_items_with_quality_flags: lib/reorient.ts + hooks/browse/use-browse-data.ts; both auth-gated.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_items_with_quality_flags() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_quality_issue_counts: app/api/quality/summary/route.ts uses getAuthenticatedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_quality_issue_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_review_breakdown_stats: app/api/review/stats/route.ts uses getAuthorisedClient(['admin','editor']).
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_review_breakdown_stats() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_tag_counts_filtered: app/api/tags/route.ts uses getAuthorisedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_tags_by_domain: app/api/tags/by-domain/route.ts uses getAuthorisedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_tags_by_domain(p_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_topic_layers: app/api/items/[id]/layers/route.ts uses getAuthenticatedClient.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_topic_layers(p_topic_id text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_user_role: HIGH-RISK — RLS-decision SECDEF. authenticated MUST retain;
-- anon MUST NOT have EXECUTE. No direct rpc() call-sites (used internally
-- by RLS policies via current_user). REVOKE anon is the explicit safety.
-- NOT an OPS-43.1 candidate — SECDEF is genuinely required (function is
-- the linchpin of the RLS access model and runs as postgres deliberately).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_workspace_counts: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (reads
-- workspaces — RLS-policied).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_workspace_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_workspace_item_counts: no current rpc() call-sites; OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_workspace_item_counts() FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- merge_entities: app/api/entities/merge/route.ts uses serviceClient (createServiceClient).
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.merge_entities(p_source_names text[], p_target_name text, p_entity_type text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- run_quality_scan: no current rpc() call-sites; SECDEF historical-only.
-- REVOKE anon safe (no callers exposed); OPS-43.1 candidate (writes
-- quality_scan_runs — RLS-policied; reads content_items).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.run_quality_scan(p_batch_name text) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- toggle_star (newer 2-arg overload): components/shared/star-button.tsx + hooks/use-item-detail-data.ts use createClient() (browser, user JWT post-login).
-- Pages using star-button are all auth-gated. OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.toggle_star(p_item_id uuid, p_starred boolean) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ----------------------------------------------------------------------------
-- §3.1 Group 4b — Pre-squash NEEDS-PER-TENANT-REVIEW SECDEF intentional-anon retain (1 entry)
-- set_config — pre-squash explicit GRANT EXECUTE TO anon (line 7821; live
-- proacl confirms anon=X/postgres EXECUTE-only). PostgREST session-config
-- wrapper used by RLS scope helpers. Both call-sites
-- (app/api/bids/[id]/responses/[rId]/route.ts:250 +
-- app/api/bids/[id]/responses/[rId]/restore/route.ts:85) use
-- getAuthorisedClient — could REVOKE anon safely from KH's perspective,
-- but the explicit GRANT predates KH and is a documented PostgREST primitive
-- (per spec §4.4). Retained as intentional-anon; AC-5 verifies it remains
-- callable. NOT an OPS-43.1 candidate.
-- ----------------------------------------------------------------------------

-- (No REVOKE for set_config — see above.)


-- ----------------------------------------------------------------------------
-- §3.1 Group 5 — Post-squash entries (6 entries from §2.4.2)
-- Pattern matches their fate column. 3 trigger fns use trigger pattern;
-- 3 SECDEF non-trigger use standard pattern with call-site triage.
-- ----------------------------------------------------------------------------

-- enforce_archive_state_consistency: trigger fn (post-squash; spec §2.4.2).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.enforce_archive_state_consistency() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- ensure_v1_history_at_commit: trigger fn (post-squash; spec §2.4.2).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.ensure_v1_history_at_commit() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- update_user_notification_prefs_updated_at: trigger fn (post-squash; spec §2.4.2).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.update_user_notification_prefs_updated_at() FROM PUBLIC, anon, authenticated;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- get_user_display_names: lib/users/display-names.ts via authenticated supabase client; integration tests use serviceClient.
-- OPS-43.1 candidate (SECDEF wraps user_profiles read; could be INVOKER).
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.get_user_display_names(user_ids uuid[]) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- hybrid_search — live signature includes visibility_filter character varying (S216 W3).
-- Spec §2.4.2 shows older 5-arg signature; live state used per IMPL brief.
-- lib/mcp/tools/search.ts + scripts/eval-search.ts callers use authenticated/service-role.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.hybrid_search(query_embedding extensions.vector, query_text text, similarity_threshold numeric, limit_count integer, include_superseded boolean, visibility_filter character varying) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;

-- search_content_chunks — live signature includes visibility_filter character varying (S216 W3).
-- Spec §2.4.2 shows older 6-arg signature; live state used per IMPL brief.
-- Used internally by lib/mcp/tools/search.ts wrapper; no direct rpc() callers in scripts.
-- OPS-43.1 candidate.
DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION public.search_content_chunks(query_embedding extensions.vector, similarity_threshold numeric, limit_count integer, filter_content_item_id uuid, filter_overdue_review boolean, filter_review_due_within_days integer, visibility_filter character varying) FROM PUBLIC, anon;
EXCEPTION
  WHEN undefined_function THEN NULL;
END;
$$;


-- ============================================================================
-- §3.6 Verification block (NOTICE-only; no transaction abort).
-- v_expected_remaining = 1 — only set_config retains anon EXECUTE.
-- The 8 KEEP-as-is functions per spec §2.3 had FROM anon revoked but
-- the FROM PUBLIC, anon pattern (per spec-template correction; see commit
-- body) also broke the implicit PUBLIC inheritance the pre-squash baseline
-- left in proacl, tightening them further. Net: 7 of 8 KEEP-as-is
-- entries no longer carry has_function_privilege('anon', oid, 'EXECUTE')
-- = TRUE either. Triage retained no additional anon entries beyond
-- set_config.
-- ============================================================================

DO $$
DECLARE
  v_remaining_anon_exposed integer;
  v_expected_remaining integer := 1;
BEGIN
  SELECT count(*) INTO v_remaining_anon_exposed
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_remaining_anon_exposed > v_expected_remaining THEN
    RAISE NOTICE 'OPS-43 REVOKE pass: % public.* fns still anon-exposed (expected = %)',
      v_remaining_anon_exposed, v_expected_remaining;
  END IF;
END
$$;
