-- ID-131.17 (G-IMS-DELETE): drop the IMS-only public.* functions left dead by
-- the deprecated browse/item UI + API-route deletion in this same Subtask.
--
-- WHY: the ratified TECH.md §Function disposition DROP set (PRODUCT BI-9,
-- BI-11, BI-12) marks these 26 functions IMS-vestige — each either binds to
-- a content_items column being dropped (user_tags, author_name, starred),
-- or serves a UI/API surface deleted in this Subtask (browse filter panel,
-- item-detail workspaces/layers panels, IMS insights analytics). A Phase-0
-- reconcile (S447) confirmed every DROP below is caller-safe once the named
-- surfaces are deleted: zero Python callers, and every TS caller lives in
-- app/api/tags/**, app/api/insights, app/api/quality[/summary],
-- app/api/read-marks, app/api/items/[id]/{workspaces,layers}, and
-- components/{content,browse,item-detail,shared}/** — all removed in the
-- same commit as this migration file.
--
-- WHAT: 26 named functions per the TECH.md DROP table, plus both overloads
-- of toggle_star (the legacy 1-arg `toggle_star(item_id)` shares the same
-- doomed `content_items.starred` column as the 2-arg named-param version
-- TECH.md names explicitly, and has zero TS callers of its own — dropping
-- only the named overload would leave an equally-dead sibling behind):
--   - Tag family (11): bulk_delete_tags, bulk_merge_tags, delete_tag,
--     merge_tags, rename_tag, suggest_tags, find_duplicate_tags,
--     get_all_tag_counts, get_tag_counts_filtered, get_tags_by_domain,
--     get_user_tag_counts — content_items.user_tags dropped (BI-11).
--   - Author family (3): get_author_analysis, get_unique_authors,
--     get_top_authors — content_items.author_name dropped (BI-11).
--   - toggle_star (both overloads) — content_items.starred dropped (BI-11).
--   - get_reading_patterns — content_items.read_marks dropped (BI-10).
--   - get_filter_counts — browse filter panel deleted (BI-12); caller was
--     hooks/browse/use-filter-data.ts.
--   - get_item_workspaces — caller was app/api/items/[id]/workspaces/route.ts
--     GET leg. That route is DEFERRED (not deleted) by the {131.17} owner
--     ruling — it stays live until the 17-final slice deletes it alongside
--     the other deferred item routes. This DROP is safe ONLY because this
--     migration's coordinated GO (below) is sequenced strictly after that
--     17-final deletion lands — by application time the route (and its RPC
--     call) no longer exists. Do NOT apply this migration before 17-final.
--   - get_topic_layers — caller was app/api/items/[id]/layers/route.ts
--     (deleted, G-IMS-DELETE).
--   - get_topic_deep_dive, get_trend_analysis, get_content_gaps — IMS
--     insights analytics; caller was app/api/insights/route.ts (deleted).
--   - get_audit_content_items, get_domain_subtopic_counts,
--     get_source_documents — confirmed-dead, no live TS caller, content_items
--     shaped.
--   - filter_by_keywords(keyword_list, match_mode) → SETOF content_items —
--     the no-op stub (BI-28). NOTE: filter_by_keywords(search_terms text[])
--     → SETOF uuid is a DISTINCT overload that stays in SURFACE_RPCS
--     (scripts/generate-api-views.ts) and is NOT touched here.
--
-- NOT dropped here (ratified exclusions):
--   - Quality-flag family (get_items_with_quality_flags,
--     get_quality_issue_counts, run_quality_scan) and
--     get_grouped_activity_feed — transitionally preserved by {131.32};
--     DROP in M6/{131.19}.
--   - api.* wrappers for every function below — {131.19}'s M6 pre-drops them
--     by exact signature, and SURFACE_RPCS pruning is {131.19}'s
--     generate-api-views.ts edit, not this migration's.
--
-- COORDINATION (do NOT apply standalone): per the {131.17} owner ruling, the
-- get_item_workspaces / get_topic_layers drops assume the 17-final route
-- deletions (app/api/items/[id]/workspaces, .../layers — layers deleted now,
-- workspaces DEFERRED) have landed; this migration applies only at the
-- parent's coordinated GO, sequenced after the 17-final route-deletion slice,
-- alongside {131.19}'s M6 api.* pre-drops and SURFACE_RPCS regen — never
-- standalone. AUTHORED here, NOT applied (no `supabase db push` run).

-- Tag family (11)
DROP FUNCTION IF EXISTS public.bulk_delete_tags(p_tags text[], p_type text);
DROP FUNCTION IF EXISTS public.bulk_merge_tags(p_sources text[], p_target text, p_type text);
DROP FUNCTION IF EXISTS public.delete_tag(p_tag text, p_type text);
DROP FUNCTION IF EXISTS public.merge_tags(p_source text, p_target text, p_type text);
DROP FUNCTION IF EXISTS public.rename_tag(p_old text, p_new text, p_type text);
DROP FUNCTION IF EXISTS public.suggest_tags(p_prefix text, p_type text);
DROP FUNCTION IF EXISTS public.find_duplicate_tags(p_type text);
DROP FUNCTION IF EXISTS public.get_all_tag_counts();
DROP FUNCTION IF EXISTS public.get_tag_counts_filtered(p_type text, p_min_count integer, p_search text, p_limit integer, p_offset integer);
DROP FUNCTION IF EXISTS public.get_tags_by_domain(p_type text);
DROP FUNCTION IF EXISTS public.get_user_tag_counts();

-- Author family (3)
DROP FUNCTION IF EXISTS public.get_author_analysis(p_author_name text);
DROP FUNCTION IF EXISTS public.get_unique_authors();
DROP FUNCTION IF EXISTS public.get_top_authors(p_limit integer);

-- toggle_star (both overloads — same doomed `starred` column)
DROP FUNCTION IF EXISTS public.toggle_star(item_id uuid);
DROP FUNCTION IF EXISTS public.toggle_star(p_item_id uuid, p_starred boolean);

-- Reading / filter / workspaces / layers / insights singles
DROP FUNCTION IF EXISTS public.get_reading_patterns(p_days integer);
DROP FUNCTION IF EXISTS public.get_filter_counts();
DROP FUNCTION IF EXISTS public.get_item_workspaces(p_item_id uuid);
DROP FUNCTION IF EXISTS public.get_topic_layers(p_topic_id text);
DROP FUNCTION IF EXISTS public.get_topic_deep_dive(p_keyword text);
DROP FUNCTION IF EXISTS public.get_trend_analysis(p_days integer, p_min_count integer);
DROP FUNCTION IF EXISTS public.get_content_gaps();

-- Confirmed-dead, no live TS caller
DROP FUNCTION IF EXISTS public.get_audit_content_items(p_domain text, p_limit integer);
DROP FUNCTION IF EXISTS public.get_domain_subtopic_counts();
DROP FUNCTION IF EXISTS public.get_source_documents();

-- Dead stub overload only — filter_by_keywords(search_terms text[]) survives
DROP FUNCTION IF EXISTS public.filter_by_keywords(keyword_list text[], match_mode text);
