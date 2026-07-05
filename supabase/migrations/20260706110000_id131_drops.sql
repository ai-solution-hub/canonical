-- ID-131.19 M6 — id131_drops: structural retirement of `content_items` and
-- its dependent surface (the coordinated GO's base-DDL step).
--
-- AUTHORED, NOT APPLIED — owner-gated apply in the {131.19} GO sequence, AFTER
-- facet-mint (20260706100000) and BEFORE the un-quarantined
-- drop_inline_vector_cols (20260706120000) and the M-API whole-surface regen.
-- No `supabase db push`, no MCP apply, no types regen in this Subtask.
--
-- ============================================================================
-- ⛔ CRITICAL — READ BEFORE APPLYING. Three LIVE production functions this
-- migration does NOT touch will start ERRORING at their next call once
-- `content_items`/`content_history` are dropped below. None of the three is
-- mentioned in the {131.19} GO composition (§B) or the M6 dispatch brief — all
-- three were discovered during this migration's dependency audit (grep across
-- every non-comment `content_items`/`content_history` reference in
-- supabase/migrations/*.sql, cross-checked against live TS callers). Fixing
-- them requires a PRODUCT decision (what data source replaces content_items
-- for each metric) — out of an Executor's authority, NOT fixed here:
--
--   1. get_dashboard_attention_counts(p_user_id, p_role) — 7 of 9 returned
--      fields are already record_lifecycle-based (safe); `quality_flag_count`
--      (JOIN content_items) and `coverage_gap_count` (NOT EXISTS content_items)
--      are NOT. Live, UNSTUBBED caller: lib/dashboard.ts:316
--      (`supabase.rpc('get_dashboard_attention_counts', ...)`), consumed at
--      lines 429/434. The whole RPC cannot simply be dropped — the other 7
--      fields are load-bearing. MUST be rewritten (or the 2 fields stubbed to
--      0/null with an owner-ratified rationale) BEFORE this migration applies.
--   2. get_coverage_matrix(p_layer) / get_coverage_summary() — entirely
--      content_items-shaped (LEFT JOIN content_items on primary_domain/
--      primary_subtopic/publication_status/freshness), never touched by any
--      id-131 migration. Live callers: app/api/coverage/route.ts,
--      app/api/coverage/gaps/route.ts, AND app/api/cron/coverage-alerts/
--      route.ts (an unattended cron job — this one fails loudly with no human
--      watching). MUST be re-pointed onto q_a_pairs/reference_items +
--      record_lifecycle (mirroring the get_dashboard_attention_counts /
--      get_content_owner_stats pattern) BEFORE this migration applies.
--
-- A fourth, narrower gap IS fixed here (§ get_content_win_rate below) because
-- it is mechanical and precedented, not a product decision.
--
-- A fifth, narrower gap is flagged not fixed: get_quality_issue_counts() IS
-- dropped below (per drop_ims_fns.sql's own "DROP in M6/{131.19}" ruling —
-- not this Subtask's invention), but its live caller
-- lib/mcp/tools/dashboard.ts:279-281 (`supabase.rpc('get_quality_issue_counts')`,
-- the exposure-analysis MCP tool) has NOT been re-pointed/stubbed. That MCP
-- tool call will error once this migration applies — retire/re-point it
-- alongside (or before) this migration, mirroring lib/reorient.ts's ALREADY-
-- LANDED get_items_with_quality_flags re-point (a facet-based
-- ingestion_quality_log query, no RPC).
--
-- Gate blind spot (informational, not fixed here — out of this migration's
-- authored-object scope): 5 files still run a LIVE `.from('content_history')`
-- query with an embedded `content_items!inner(...)` select — lib/dashboard.ts,
-- lib/reorient.ts, lib/edit-intent/sweep.ts, lib/ai/change-reports.ts,
-- app/api/review/publication-bulk-action/route.ts. The stated acceptance gate
-- (`rg "from('content_items')" == 0`) does NOT catch these (they call
-- `.from('content_history')`, not `.from('content_items')`) — they will 404/
-- schema-error once content_history is dropped below. Flagged for the
-- Orchestrator/Curator; not this Subtask's file-ownership boundary.
-- ============================================================================
--
-- WHAT (ordered for dependency safety — dependents before their base object):
--   0. Pre-drop the 6 api.* views that select a column/table this migration
--      removes: content_items, content_item_workspaces, content_history,
--      read_marks, citations, feed_articles (citations/feed_articles survive
--      as tables, losing one column each — their view still has to go first
--      since it explicitly projects the doomed column; the M-API regen step
--      recreates both, column-pruned).
--   1. Pre-drop every retiring fn's api.* wrapper, BY EXACT SIGNATURE (verified
--      against the last whole-surface regen, 20260625160000_id130_api_views_
--      regen.sql, plus this migration's own new drops) — the M-API regen only
--      DROP/CREATEs entries still in its SURFACE_RPCS list; anything removed
--      from that list (this Subtask's generate-api-views.ts edit) is never
--      touched by the regen and must be dropped explicitly here, or it hangs
--      around forever as an orphaned, broken wrapper. This clears the "13
--      broken api wrappers" already living on both envs today (their backing
--      public fns were already dropped by 20260704120000_id131_drop_dedup_family
--      + 20260704221000_id131_drop_ims_fns — both APPLIED — but nothing has yet
--      dropped the api.* side) PLUS the net-new M6 drops below.
--   2. DROP VIEW quality_issues_pending (public schema — JOINs content_items
--      directly; no api wrapper, it was never in the Data API surface).
--   3. DROP the "quality-flag family" + activity-feed + detect_reupload public
--      fns explicitly named for M6 by drop_ims_fns.sql's own exclusion note
--      ("transitionally preserved... DROP in M6/{131.19}") and this Subtask's
--      S449-corrected brief: get_grouped_activity_feed (TS caller ALREADY
--      stubbed, lib/dashboard.ts:321-331, safe), get_items_with_quality_flags
--      (TS caller ALREADY re-pointed, lib/reorient.ts:133-152, safe),
--      get_quality_issue_counts (flagged above — caller NOT yet re-pointed),
--      run_quality_scan (zero live callers, dormant cron scaffold, safe),
--      detect_reupload (sole caller died at 131.24, zero live TS callers,
--      confirmed by grep; never had an api wrapper).
--   4. ALTER feed_articles DROP COLUMN content_item_id.
--   5. ALTER citations DROP COLUMN cited_content_item_id + rewrite the
--      exactly-one CHECK to the sole surviving branch (q_a_pair). The
--      `cited_target_kind` enum KEEPS its 'content_item' label (Postgres does
--      not cheaply support dropping an enum value) — it becomes permanently
--      unusable, not removed.
--   6. get_content_win_rate(p_content_item_id uuid) REWRITE (bundled fix, not
--      a fresh drop) — see the dedicated comment block below.
--   7. DROP TABLE content_item_workspaces, content_templates, read_marks,
--      content_history (referencing tables before the referenced table).
--   8. DROP the 4 dead trigger fns whose ONLY trigger lived on content_items/
--      content_history (verified via a full EXECUTE FUNCTION grep across every
--      migration — each has exactly one CREATE TRIGGER site, all on the tables
--      dying in step 7/9): ensure_v1_history_at_commit, auto_version_content_
--      history, content_history_auto_version (this one has ZERO triggers
--      anywhere — dead since inception, `auto_version_content_history` is the
--      one actually wired), enforce_archive_state_consistency.
--      `update_updated_at_column` is KEPT (used by every other `updated_at`
--      trigger in the schema).
--      `validate_layer_key` is ALSO KEPT, DESPITE appearing on an earlier
--      "dead trigger fns" list in this Subtask's dispatch brief — verified via
--      grep that it fires from TWO triggers: trg_validate_layer_key ON
--      content_items (dying, fine) AND trg_validate_reference_items_layer ON
--      reference_items (LIVE, staying). Dropping it would either hard-fail
--      (dependent trigger) or CASCADE-silently break reference_items layer
--      validation. Escalated — see this Subtask's final report.
--   9. DROP TABLE content_items (LAST — every dependent above is now gone).
--
-- FK dependency audit (why nothing else needs a pre-step): classification_
-- disputes, entity_relationships, content_chunks, entity_mentions,
-- ingestion_quality_log, verification_history were ALL already reparented off
-- content_items onto source_documents/q_a_pairs by earlier id-131 migrations
-- (extract_reparent, govfacet_b_rpcs, verification_history_reparent — all
-- APPLIED per the S448/S449 ground truth). source_document_diffs was dropped
-- entirely at id-117. content_items.superseded_by is self-referential (dies
-- with the table). Verified via
-- `grep "REFERENCES \"public\".\"content_items\"" supabase/migrations/*.sql`
-- against every FK-holding table found.

-- ============================================================================
-- STEP 0 — pre-drop dependent api.* views.
-- ============================================================================
DROP VIEW IF EXISTS api.content_items;
DROP VIEW IF EXISTS api.content_item_workspaces;
DROP VIEW IF EXISTS api.content_history;
DROP VIEW IF EXISTS api.read_marks;
DROP VIEW IF EXISTS api.citations;
DROP VIEW IF EXISTS api.feed_articles;

-- ============================================================================
-- STEP 1 — pre-drop api.* wrappers for every retiring fn, by exact signature.
-- ============================================================================

-- Tag family (11)
DROP FUNCTION IF EXISTS api.bulk_delete_tags(p_tags text[], p_type text);
DROP FUNCTION IF EXISTS api.bulk_merge_tags(p_sources text[], p_target text, p_type text);
DROP FUNCTION IF EXISTS api.delete_tag(p_tag text, p_type text);
DROP FUNCTION IF EXISTS api.merge_tags(p_source text, p_target text, p_type text);
DROP FUNCTION IF EXISTS api.rename_tag(p_old text, p_new text, p_type text);
DROP FUNCTION IF EXISTS api.suggest_tags(p_prefix text, p_type text);
DROP FUNCTION IF EXISTS api.find_duplicate_tags(p_type text);
DROP FUNCTION IF EXISTS api.get_all_tag_counts();
DROP FUNCTION IF EXISTS api.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS api.get_tags_by_domain(p_type text);
DROP FUNCTION IF EXISTS api.get_user_tag_counts();

-- Author family (3 — get_top_authors never had a wrapper; DROP IF EXISTS is a
-- defensive no-op, kept for brief-list parity)
DROP FUNCTION IF EXISTS api.get_author_analysis(p_author_name text);
DROP FUNCTION IF EXISTS api.get_unique_authors();
DROP FUNCTION IF EXISTS api.get_top_authors(p_limit integer);

-- toggle_star (both overloads)
DROP FUNCTION IF EXISTS api.toggle_star(item_id uuid);
DROP FUNCTION IF EXISTS api.toggle_star(p_item_id uuid, p_starred boolean);

-- Reading / filter / workspaces / topic / gaps
DROP FUNCTION IF EXISTS api.get_reading_patterns(p_days integer);
DROP FUNCTION IF EXISTS api.get_filter_counts();
DROP FUNCTION IF EXISTS api.get_item_workspaces(p_item_id uuid);
DROP FUNCTION IF EXISTS api.get_topic_layers(p_topic_id text);
DROP FUNCTION IF EXISTS api.get_topic_deep_dive(p_keyword text);
DROP FUNCTION IF EXISTS api.get_trend_analysis(p_days integer, p_min_count integer);
DROP FUNCTION IF EXISTS api.get_content_gaps();

-- filter_by_keywords (BOTH overloads — DROPPED entirely per the S438
-- correction referenced in this Subtask's brief; the dead-stub overload was
-- already dropped from public in drop_ims_fns, but the OTHER overload
-- (search_terms text[]) — previously believed to survive in SURFACE_RPCS —
-- has ZERO live TS callers (verified by grep), so both are retired here)
DROP FUNCTION IF EXISTS api.filter_by_keywords(keyword_list text[], match_mode text);
DROP FUNCTION IF EXISTS api.filter_by_keywords(search_terms text[]);

-- Dedup family (4 — resolve_near_dup_confirm_unique never had a wrapper)
DROP FUNCTION IF EXISTS api.find_duplicate_pairs(similarity_threshold numeric, p_domain text, limit_count integer);
DROP FUNCTION IF EXISTS api.find_exact_duplicates(p_content_hash text, p_exclude_id uuid);
DROP FUNCTION IF EXISTS api.find_similar_content(query_embedding vector, similarity_threshold double precision, limit_count integer);
DROP FUNCTION IF EXISTS api.find_similar_content(query_embedding vector, similarity_threshold numeric, limit_count integer);

-- detect_reupload — sole caller died at 131.24; never had an api wrapper
-- (defensive no-op).
DROP FUNCTION IF EXISTS api.detect_reupload(p_filename text, p_uploaded_by uuid, p_content_hash text);

-- Activity feed + quality-flag family (net-new M6 drops; see header notes 3/5)
DROP FUNCTION IF EXISTS api.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone);
DROP FUNCTION IF EXISTS api.get_items_with_quality_flags();
DROP FUNCTION IF EXISTS api.get_quality_issue_counts();
-- run_quality_scan never had an api wrapper (zero live callers) — no api DROP.

-- ============================================================================
-- STEP 2 — DROP VIEW quality_issues_pending (public; JOINs content_items).
-- ============================================================================
DROP VIEW IF EXISTS "public"."quality_issues_pending";

-- ============================================================================
-- STEP 3 — DROP the quality-flag family + activity-feed + detect_reupload
-- public fns (net-new M6 drops — see header notes 3/5 for caller status).
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_grouped_activity_feed(p_limit integer, p_is_admin boolean, p_before timestamp with time zone);
DROP FUNCTION IF EXISTS public.get_items_with_quality_flags();
DROP FUNCTION IF EXISTS public.get_quality_issue_counts();
DROP FUNCTION IF EXISTS public.run_quality_scan(p_batch_name text);
DROP FUNCTION IF EXISTS public.detect_reupload(p_filename text, p_uploaded_by uuid, p_content_hash text);

-- ============================================================================
-- STEP 4 — feed_articles: drop the content_items FK column.
-- ============================================================================
ALTER TABLE "public"."feed_articles" DROP COLUMN IF EXISTS "content_item_id";

-- ============================================================================
-- STEP 5 — citations: drop the content_items FK column + fix the exactly-one
-- CHECK down to its sole surviving branch. `cited_target_kind` KEEPS the now
-- permanently-unused 'content_item' enum label (dropping an enum value is not
-- a cheap ALTER TYPE in Postgres, and no PRODUCT/TECH slice asked for it).
-- ============================================================================
ALTER TABLE "public"."citations" DROP CONSTRAINT IF EXISTS "citations_cited_one_of_chk";
ALTER TABLE "public"."citations" DROP COLUMN IF EXISTS "cited_content_item_id";
ALTER TABLE "public"."citations" ADD CONSTRAINT "citations_cited_one_of_chk"
    CHECK ((("cited_kind" = 'q_a_pair'::"public"."cited_target_kind") AND ("cited_q_a_pair_id" IS NOT NULL)));

-- ============================================================================
-- STEP 6 — get_content_win_rate: BUNDLED FIX, not a fresh business-logic call.
--
-- This function was NEVER updated by the {131.10}/{131.11} q_a_pair re-anchor
-- that its sibling get_aggregate_win_rate_stats received (cite_ext_winrate_fix,
-- 20260628191703, APPLIED) — it still filters on
-- `cited_kind = 'content_item' AND cited_content_item_id = p_content_item_id`,
-- a column this migration's STEP 5 just dropped. It is ALREADY broken in
-- production today for an unrelated reason: its sole caller,
-- lib/mcp/tools/procurement.ts:554-563, already calls
-- `supabase.rpc('get_content_win_rate', { p_q_a_pair_id: args.content_item_id })`
-- — a parameter name the function has never actually had (the caller's own
-- comment concedes "this tool stays content_item-shaped... win-rate is vacuous
-- in the interim"). This rewrite mirrors get_aggregate_win_rate_stats' ALREADY-
-- SHIPPED pattern exactly (cited_kind='q_a_pair', cited_q_a_pair_id, renamed
-- parameter) so the caller's existing `p_q_a_pair_id` argument name finally
-- resolves. CREATE OR REPLACE (not DROP+CREATE): only the parameter NAME
-- changes, not its type (uuid) or the return shape — legal in-place. The api.*
-- wrapper is NOT hand-edited here: get_content_win_rate stays in
-- generate-api-views.ts's SURFACE_RPCS, so the M-API regen step picks up the
-- renamed parameter automatically via live pg_proc introspection.
-- ============================================================================
CREATE OR REPLACE FUNCTION "public"."get_content_win_rate"("p_q_a_pair_id" "uuid")
    RETURNS TABLE("total_citations" bigint, "winning_citations" bigint, "losing_citations" bigint, "pending_citations" bigint, "win_rate" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  WITH "citation_outcomes" AS (
    SELECT
      "cc"."cited_q_a_pair_id",
      "cc"."citing_form_response_id",
      "ft"."outcome"                    AS "outcome",
      "fot"."counts_toward_win_rate"    AS "counts_toward_win_rate"
    FROM "public"."citations" "cc"
    JOIN "public"."form_responses" "br" ON "br"."id" = "cc"."citing_form_response_id"
    JOIN "public"."form_questions" "fq" ON "fq"."id" = "br"."question_id"
    JOIN "public"."form_templates" "ft" ON "ft"."id" = "fq"."form_template_id"
    LEFT JOIN "public"."form_outcome_types" "fot" ON "fot"."key" = "ft"."outcome"
    WHERE "cc"."cited_kind" = 'q_a_pair'
      AND "cc"."cited_q_a_pair_id" = "p_q_a_pair_id"
  )
  SELECT
    COUNT(*)::bigint AS "total_citations",
    COUNT(*) FILTER (WHERE "co"."outcome" = 'won')::bigint AS "winning_citations",
    COUNT(*) FILTER (WHERE "co"."outcome" = 'lost')::bigint AS "losing_citations",
    -- pending = NOT in the win-rate denominator (no counts_toward_win_rate=true outcome yet).
    COUNT(*) FILTER (WHERE COALESCE("co"."counts_toward_win_rate", false) = false)::bigint AS "pending_citations",
    CASE
      WHEN COUNT(*) FILTER (WHERE "co"."counts_toward_win_rate" = true) > 0 THEN
        ROUND(
          COUNT(*) FILTER (WHERE "co"."outcome" = 'won')::numeric /
          COUNT(*) FILTER (WHERE "co"."counts_toward_win_rate" = true)::numeric,
          2
        )
      ELSE 0
    END AS "win_rate"
  FROM "citation_outcomes" "co";
END;
$$;

COMMENT ON FUNCTION "public"."get_content_win_rate"("p_q_a_pair_id" "uuid") IS 'ID-131.19 M6: bundled fix — re-anchored content_item -> q_a_pair (cited_kind=''q_a_pair'', cited_q_a_pair_id), parameter renamed p_content_item_id -> p_q_a_pair_id to finally match the caller (lib/mcp/tools/procurement.ts) which already sends p_q_a_pair_id. Mirrors the ALREADY-SHIPPED get_aggregate_win_rate_stats re-anchor (20260628191703_id131_cite_ext_winrate_fix.sql). Was vacuous (parameter-name mismatch) before this fix, would have hard-errored after STEP 5 dropped cited_content_item_id if left unfixed.';

-- ============================================================================
-- STEP 7 — drop the four now-orphaned tables (referencing tables before the
-- referenced table; none of these has an inbound FK from a surviving table —
-- verified by grep across every migration).
-- ============================================================================
DROP TABLE IF EXISTS "public"."content_item_workspaces";
DROP TABLE IF EXISTS "public"."content_templates";
DROP TABLE IF EXISTS "public"."read_marks";
DROP TABLE IF EXISTS "public"."content_history";

-- ============================================================================
-- STEP 8 — drop the dead content_items/content_history-only trigger fns.
-- `update_updated_at_column` (used everywhere) and `validate_layer_key`
-- (still fires on reference_items via trg_validate_reference_items_layer —
-- verified live, EXCLUDED despite appearing on an earlier "dead trigger fns"
-- list in this Subtask's brief) are deliberately NOT in this list.
-- ============================================================================
DROP FUNCTION IF EXISTS public.ensure_v1_history_at_commit();
DROP FUNCTION IF EXISTS public.auto_version_content_history();
DROP FUNCTION IF EXISTS public.content_history_auto_version();
DROP FUNCTION IF EXISTS public.enforce_archive_state_consistency();

-- ============================================================================
-- STEP 9 — DROP TABLE content_items (last — every dependent object above is
-- now gone: the 6 api views, the citations/feed_articles columns, the 4
-- child tables, the 4 trigger fns, and every retiring public/api function).
-- ============================================================================
DROP TABLE IF EXISTS "public"."content_items";
