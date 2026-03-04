-- =============================================================================
-- Migration 2: Base Schema Functions & Views
-- =============================================================================
-- Applied remotely via Supabase MCP on 4 March 2026
--
-- Creates 22 RPC functions carried forward from IMS (signatures only below;
-- full bodies applied via MCP). Plus 2 views.
--
-- Search & Discovery:
--   1.  hybrid_search(query_text, query_embedding, match_count, ...)
--   2.  find_similar_content(item_id, match_count, similarity_threshold)
--   3.  search_content(search_query, content_type_filter, domain_filter, ...)
--   4.  filter_by_keywords(keyword_list, match_mode)
--
-- Content Management:
--   5.  toggle_star(item_id)
--   6.  merge_item_metadata(item_id, new_metadata)
--
-- Analytics - Filter Counts:
--   7.  get_domain_subtopic_counts()
--   8.  get_filter_counts()
--   9.  get_unique_authors()
--   10. get_popular_keywords(limit_count)
--   11. get_item_projects(item_id)
--   12. get_project_counts()
--   13. get_project_item_counts()
--   14. get_user_tag_counts()
--
-- Analytics - Deep Dive:
--   15. get_trend_analysis(days_back, bucket_size)
--   16. get_topic_deep_dive(topic_name)
--   17. get_author_analysis(limit_count)
--   18. get_content_gaps()
--   19. get_reading_patterns(days_back)
--   20. get_capture_activity(days_back)
--   21. get_top_authors(limit_count)
--
-- Views:
--   22. content_items_overview  (content_items + project names + read status)
--   23. quality_issues_pending  (unresolved quality flags with item titles)
-- =============================================================================

-- 1. hybrid_search: Combined vector + full-text search with RRF ranking
CREATE OR REPLACE FUNCTION hybrid_search(
    query_text      TEXT,
    query_embedding vector(1536),
    match_count     INTEGER DEFAULT 20,
    full_text_weight FLOAT DEFAULT 1.0,
    semantic_weight  FLOAT DEFAULT 1.0,
    rrf_k           INTEGER DEFAULT 50
) RETURNS TABLE (
    id UUID, title TEXT, body TEXT, content_type TEXT, domain TEXT,
    similarity FLOAT, rank FLOAT
) LANGUAGE plpgsql AS $$ ... $$;

-- 2. find_similar_content
CREATE OR REPLACE FUNCTION find_similar_content(
    item_id              UUID,
    match_count          INTEGER DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.7
) RETURNS TABLE (id UUID, title TEXT, similarity FLOAT)
LANGUAGE plpgsql AS $$ ... $$;

-- 3. search_content
CREATE OR REPLACE FUNCTION search_content(
    search_query         TEXT DEFAULT NULL,
    content_type_filter  TEXT DEFAULT NULL,
    domain_filter        TEXT DEFAULT NULL,
    limit_count          INTEGER DEFAULT 50,
    offset_count         INTEGER DEFAULT 0
) RETURNS TABLE (id UUID, title TEXT, content_type TEXT, domain TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$ ... $$;

-- 4. filter_by_keywords
CREATE OR REPLACE FUNCTION filter_by_keywords(
    keyword_list TEXT[],
    match_mode   TEXT DEFAULT 'any'
) RETURNS SETOF content_items
LANGUAGE plpgsql AS $$ ... $$;

-- 5. toggle_star
CREATE OR REPLACE FUNCTION toggle_star(item_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$ ... $$;

-- 6. merge_item_metadata
CREATE OR REPLACE FUNCTION merge_item_metadata(item_id UUID, new_metadata JSONB)
RETURNS JSONB LANGUAGE plpgsql AS $$ ... $$;

-- 7-14. Analytics filter functions
CREATE OR REPLACE FUNCTION get_domain_subtopic_counts()
RETURNS TABLE (domain TEXT, subdomain TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_filter_counts()
RETURNS JSON LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_unique_authors()
RETURNS TABLE (author TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_popular_keywords(limit_count INTEGER DEFAULT 20)
RETURNS TABLE (keyword TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_item_projects(p_item_id UUID)
RETURNS TABLE (id UUID, name TEXT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_project_counts()
RETURNS TABLE (project_id UUID, name TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_project_item_counts()
RETURNS TABLE (project_id UUID, name TEXT, item_count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_user_tag_counts()
RETURNS TABLE (tag TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

-- 15-21. Analytics deep-dive functions
CREATE OR REPLACE FUNCTION get_trend_analysis(
    days_back   INTEGER DEFAULT 30,
    bucket_size TEXT DEFAULT 'day'
) RETURNS TABLE (period TIMESTAMPTZ, count BIGINT, content_types JSON)
LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_topic_deep_dive(topic_name TEXT)
RETURNS JSON LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_author_analysis(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (author TEXT, item_count BIGINT, domains TEXT[], latest TIMESTAMPTZ)
LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_content_gaps()
RETURNS JSON LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_reading_patterns(days_back INTEGER DEFAULT 30)
RETURNS JSON LANGUAGE plpgsql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_capture_activity(days_back INTEGER DEFAULT 30)
RETURNS TABLE (period TIMESTAMPTZ, count BIGINT) LANGUAGE sql AS $$ ... $$;

CREATE OR REPLACE FUNCTION get_top_authors(limit_count INTEGER DEFAULT 10)
RETURNS TABLE (author TEXT, count BIGINT) LANGUAGE sql AS $$ ... $$;

-- Views
CREATE OR REPLACE VIEW content_items_overview AS
SELECT ci.*, array_agg(p.name) AS project_names
FROM content_items ci
LEFT JOIN content_item_projects cip ON ci.id = cip.content_item_id
LEFT JOIN projects p ON cip.project_id = p.id
GROUP BY ci.id;

CREATE OR REPLACE VIEW quality_issues_pending AS
SELECT iql.*, ci.title AS item_title
FROM ingestion_quality_log iql
JOIN content_items ci ON iql.content_item_id = ci.id
WHERE iql.resolved = FALSE;
