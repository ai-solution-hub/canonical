-- Content Archive Infrastructure
-- 1. Add archive columns to content_items
-- 2. Update content_history change_type constraint
-- 3. Update search and analytics RPCs to exclude archived items
-- 4. Add find_duplicate_pairs RPC for duplicate detection

SET search_path TO public, extensions;

-- 1. Add archive columns
ALTER TABLE content_items 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users,
ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- 2. Update content_history change_type constraint
ALTER TABLE content_history DROP CONSTRAINT IF EXISTS content_history_change_type_check;
ALTER TABLE content_history ADD CONSTRAINT content_history_change_type_check 
CHECK (change_type::text = ANY (ARRAY['create'::text, 'edit'::text, 'ai_update'::text, 'import'::text, 'merge'::text, 'rollback'::text, 'archive'::text, 'delete'::text]));

-- 3. Update RPCs

-- 3.1 hybrid_search
DROP FUNCTION IF EXISTS hybrid_search(vector, text, double precision, integer);
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector,
  query_text text,
  similarity_threshold double precision DEFAULT 0.3,
  limit_count integer DEFAULT 20
)
RETURNS TABLE(
  id UUID, title TEXT, suggested_title TEXT, ai_summary TEXT,
  primary_domain CHARACTER VARYING, primary_subtopic CHARACTER VARYING,
  content_type CHARACTER VARYING, platform CHARACTER VARYING,
  author_name CHARACTER VARYING, source_domain CHARACTER VARYING,
  thumbnail_url TEXT, captured_date TIMESTAMPTZ,
  ai_keywords TEXT[], classification_confidence NUMERIC,
  priority CHARACTER VARYING, metadata JSONB,
  similarity NUMERIC, snippet TEXT, created_by UUID
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT
      cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.suggested_title, ci.ai_summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence, ci.priority, ci.metadata,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.70
      + CASE WHEN ci.suggested_title ILIKE '%' || query_text || '%' THEN 0.15
             WHEN ci.title ILIKE '%' || query_text || '%' THEN 0.15
             ELSE 0.0 END
      + CASE WHEN query_text = ANY(ci.ai_keywords) THEN 0.10
             WHEN EXISTS (SELECT 1 FROM unnest(ci.ai_keywords) AS kw WHERE kw ILIKE '%' || query_text || '%') THEN 0.05
             ELSE 0.0 END
      + CASE WHEN ci.ai_summary ILIKE '%' || query_text || '%' THEN 0.03 ELSE 0.0 END
      + CASE WHEN ci.author_name ILIKE '%' || query_text || '%' THEN 0.02 ELSE 0.0 END
      + CASE WHEN ci.captured_date IS NOT NULL AND ci.captured_date > NOW() - INTERVAL '30 days'
             THEN 0.05 * (1.0 - EXTRACT(EPOCH FROM (NOW() - ci.captured_date)) / (30.0 * 86400.0))
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity,
    CASE WHEN query_text IS NOT NULL AND query_text != '' AND ci.content IS NOT NULL
         AND position(lower(query_text) IN lower(ci.content)) > 0
         THEN substring(ci.content FROM greatest(1, position(lower(query_text) IN lower(ci.content)) - 80) FOR 200)
         ELSE NULL END AS snippet,
    ci.created_by
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

-- 3.2 search_for_bid_response
DROP FUNCTION IF EXISTS search_for_bid_response(vector, text, integer);
CREATE OR REPLACE FUNCTION search_for_bid_response(
  query_embedding vector,
  query_text text DEFAULT '',
  limit_count integer DEFAULT 10
)
RETURNS TABLE(
  id UUID, title TEXT, content TEXT, brief TEXT, detail TEXT,
  primary_domain CHARACTER VARYING, primary_subtopic CHARACTER VARYING,
  content_type CHARACTER VARYING, ai_keywords TEXT[], similarity NUMERIC
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  win_boost CONSTANT numeric := 0.03;
  min_win_citations CONSTANT integer := 2;
BEGIN
  RETURN QUERY
  WITH win_stats AS (
    SELECT
      cc.content_item_id,
      COUNT(DISTINCT cc.bid_response_id)::integer AS total_citations,
      COUNT(DISTINCT cc.bid_response_id) FILTER (
        WHERE w.domain_metadata->>'outcome' = 'won'
      )::numeric / NULLIF(COUNT(DISTINCT cc.bid_response_id), 0) AS win_rate
    FROM content_citations cc
    JOIN bid_responses br ON br.id = cc.bid_response_id
    JOIN bid_questions bq ON bq.id = br.question_id
    JOIN workspaces w ON w.id = bq.project_id
    GROUP BY cc.content_item_id
  )
  SELECT
    ci.id, ci.title, ci.content, ci.brief, ci.detail,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.ai_keywords,
    LEAST(1.0, (
      (1 - (ci.embedding <=> query_embedding)) * 0.80
      + CASE WHEN query_text != '' AND ci.title ILIKE '%' || query_text || '%' THEN 0.10
             ELSE 0.0 END
      + CASE WHEN query_text != '' AND query_text = ANY(ci.ai_keywords) THEN 0.10
             ELSE 0.0 END
    ) * CASE
        WHEN COALESCE(ws.total_citations, 0) >= min_win_citations
        THEN (1.0 + win_boost * COALESCE(ws.win_rate, 0.0))
        ELSE 1.0
      END
    )::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  LEFT JOIN win_stats ws ON ws.content_item_id = ci.id
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > 0.25
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

-- 3.3 find_similar_content
DROP FUNCTION IF EXISTS find_similar_content(UUID, INTEGER, FLOAT);
CREATE OR REPLACE FUNCTION find_similar_content(
    query_embedding      vector,
    similarity_threshold FLOAT DEFAULT 0.7,
    limit_count          INTEGER DEFAULT 10
) RETURNS TABLE (
    id UUID, title TEXT, content TEXT, similarity NUMERIC,
    content_type CHARACTER VARYING, platform CHARACTER VARYING, 
    author_name CHARACTER VARYING, source_domain CHARACTER VARYING
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.content,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
    ci.content_type, ci.platform, ci.author_name, ci.source_domain
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;

-- 3.4 search_content
DROP FUNCTION IF EXISTS search_content(TEXT, TEXT, TEXT, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION search_content(
    query_embedding      vector,
    similarity_threshold FLOAT DEFAULT 0.3,
    limit_count          INTEGER DEFAULT 50
) RETURNS TABLE (
    id UUID, title TEXT, suggested_title TEXT, ai_summary TEXT,
    primary_domain CHARACTER VARYING, primary_subtopic CHARACTER VARYING, 
    content_type CHARACTER VARYING, platform CHARACTER VARYING,
    author_name CHARACTER VARYING, source_domain CHARACTER VARYING, 
    thumbnail_url TEXT, captured_date TIMESTAMPTZ,
    ai_keywords TEXT[], classification_confidence NUMERIC,
    similarity NUMERIC
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT ci.id, ci.title, ci.suggested_title, ci.ai_summary,
    ci.primary_domain, ci.primary_subtopic, ci.content_type, ci.platform,
    ci.author_name, ci.source_domain, ci.thumbnail_url, ci.captured_date,
    ci.ai_keywords, ci.classification_confidence,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY ci.embedding <=> query_embedding
  LIMIT limit_count;
END;
$$;

-- 3.5 get_coverage_matrix
DROP FUNCTION IF EXISTS get_coverage_matrix(TEXT);
CREATE OR REPLACE FUNCTION get_coverage_matrix(p_layer TEXT DEFAULT NULL)
RETURNS TABLE (
    domain_name TEXT,
    subtopic_name TEXT,
    item_count BIGINT,
    fresh_count BIGINT,
    aging_count BIGINT,
    stale_count BIGINT,
    expired_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.name::text                                            AS domain_name,
    s.name::text                                            AS subtopic_name,
    COUNT(ci.id)                                            AS item_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh')      AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'aging')      AS aging_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'stale')      AS stale_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')    AS expired_count
  FROM taxonomy_domains d
  INNER JOIN taxonomy_subtopics s ON s.domain_id = d.id AND s.is_active = TRUE
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.primary_subtopic = s.name
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (p_layer IS NULL OR ci.metadata->>'layer' = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
END;
$$;

-- 3.6 get_coverage_summary
DROP FUNCTION IF EXISTS get_coverage_summary();
CREATE OR REPLACE FUNCTION get_coverage_summary()
RETURNS TABLE (
    domain_name TEXT,
    domain_colour TEXT,
    total_items BIGINT,
    fresh_pct NUMERIC,
    gap_count BIGINT,
    expired_count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.name::text                                              AS domain_name,
    d.colour::text                                            AS domain_colour,
    COUNT(ci.id)                                              AS total_items,
    CASE
      WHEN COUNT(ci.id) = 0 THEN 0
      ELSE ROUND(
        100.0 * COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh') / COUNT(ci.id),
        1
      )
    END                                                       AS fresh_pct,
    (
      SELECT COUNT(*)
      FROM taxonomy_subtopics sub
      WHERE sub.domain_id = d.id
        AND sub.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM content_items ci2
          WHERE ci2.primary_domain = d.name
            AND ci2.primary_subtopic = sub.name
            AND ci2.archived_at IS NULL
            AND (ci2.governance_review_status IS NULL OR ci2.governance_review_status != 'draft')
        )
    )                                                         AS gap_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')      AS expired_count
  FROM taxonomy_domains d
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
  WHERE d.is_active = TRUE
  GROUP BY d.id, d.name, d.colour, d.display_order
  ORDER BY d.display_order;
END;
$$;

-- 3.7 get_freshness_breakdown
DROP FUNCTION IF EXISTS get_freshness_breakdown();
CREATE OR REPLACE FUNCTION get_freshness_breakdown()
RETURNS TABLE (freshness TEXT, count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT ci.freshness::text, COUNT(*) 
  FROM content_items ci
  WHERE ci.freshness IS NOT NULL 
    AND ci.archived_at IS NULL
  GROUP BY ci.freshness;
END;
$$;

-- 3.8 get_domain_subtopic_counts
DROP FUNCTION IF EXISTS get_domain_subtopic_counts();
CREATE OR REPLACE FUNCTION get_domain_subtopic_counts()
RETURNS TABLE (primary_domain TEXT, primary_subtopic TEXT, item_count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT ci.primary_domain::TEXT, ci.primary_subtopic::TEXT, COUNT(*) AS item_count
  FROM content_items ci
  WHERE ci.primary_domain IS NOT NULL
    AND ci.archived_at IS NULL
  GROUP BY ci.primary_domain, ci.primary_subtopic 
  ORDER BY ci.primary_domain, item_count DESC;
END;
$$;

-- 3.9 get_filter_counts
DROP FUNCTION IF EXISTS get_filter_counts();
CREATE OR REPLACE FUNCTION get_filter_counts()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN jsonb_build_object(
    'domain', COALESCE((SELECT jsonb_object_agg(primary_domain, cnt) FROM (SELECT primary_domain, COUNT(*) as cnt FROM content_items WHERE primary_domain IS NOT NULL AND archived_at IS NULL GROUP BY primary_domain) d), '{}'::jsonb),
    'content_type', COALESCE((SELECT jsonb_object_agg(content_type, cnt) FROM (SELECT content_type, COUNT(*) as cnt FROM content_items WHERE content_type IS NOT NULL AND archived_at IS NULL GROUP BY content_type) t), '{}'::jsonb),
    'platform', COALESCE((SELECT jsonb_object_agg(platform, cnt) FROM (SELECT platform, COUNT(*) as cnt FROM content_items WHERE platform IS NOT NULL AND archived_at IS NULL GROUP BY platform) p), '{}'::jsonb)
  );
END;
$$;

-- 3.10 get_quality_issue_counts
DROP FUNCTION IF EXISTS get_quality_issue_counts();
CREATE OR REPLACE FUNCTION get_quality_issue_counts()
RETURNS TABLE (
    flag_type TEXT,
    severity TEXT,
    open_count BIGINT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        iql.flag_type,
        iql.severity,
        COUNT(*) AS open_count
    FROM ingestion_quality_log iql
    LEFT JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND (ci.id IS NULL OR ci.archived_at IS NULL)
    GROUP BY iql.flag_type, iql.severity
    ORDER BY
        CASE iql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
        iql.flag_type;
$$;

-- 3.11 get_items_with_quality_flags
DROP FUNCTION IF EXISTS get_items_with_quality_flags();
CREATE OR REPLACE FUNCTION get_items_with_quality_flags()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT DISTINCT iql.content_item_id
    FROM ingestion_quality_log iql
    JOIN content_items ci ON iql.content_item_id = ci.id
    WHERE iql.resolved = FALSE
      AND iql.content_item_id IS NOT NULL
      AND ci.archived_at IS NULL;
$$;

-- 3.12 get_content_gaps
DROP FUNCTION IF EXISTS get_content_gaps();
CREATE OR REPLACE FUNCTION get_content_gaps()
RETURNS JSON
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN json_build_object(
    'sparse_subtopics', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'subtopic', primary_subtopic, 'count', cnt, 'latest', latest) ORDER BY cnt ASC)
      FROM (SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt, MAX(captured_date) AS latest
        FROM content_items WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL AND archived_at IS NULL
        GROUP BY primary_domain, primary_subtopic HAVING COUNT(*) < 5) sub),
    'stale_subtopics', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'subtopic', primary_subtopic,
        'count', cnt, 'latest', latest, 'days_since', EXTRACT(DAY FROM NOW() - latest)::INT) ORDER BY latest ASC)
        FROM (SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt, MAX(captured_date) AS latest
        FROM content_items WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL AND archived_at IS NULL
        GROUP BY primary_domain, primary_subtopic HAVING MAX(captured_date) < NOW() - INTERVAL '30 days') sub),
    'domain_summary', (
      SELECT json_agg(json_build_object('domain', primary_domain, 'total_items', cnt,
        'subtopic_count', subtopics, 'latest', latest, 'avg_confidence', avg_conf) ORDER BY cnt DESC)
      FROM (SELECT primary_domain, COUNT(*) AS cnt, COUNT(DISTINCT primary_subtopic) AS subtopics,
        MAX(captured_date) AS latest, ROUND(AVG(classification_confidence)::NUMERIC, 3) AS avg_conf
        FROM content_items WHERE primary_domain IS NOT NULL AND archived_at IS NULL GROUP BY primary_domain) sub)
  );
END;
$$;

-- 3.13 recalculate_all_freshness
DROP FUNCTION IF EXISTS recalculate_all_freshness();
CREATE OR REPLACE FUNCTION recalculate_all_freshness()
RETURNS TABLE (total_count INTEGER, fresh_count INTEGER, aging_count INTEGER, stale_count INTEGER, expired_count INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now timestamptz := now();
  v_total int := 0;
  v_fresh int := 0;
  v_aging int := 0;
  v_stale int := 0;
  v_expired int := 0;
BEGIN
  -- bid_discovered: always fresh
  UPDATE content_items
  SET freshness = 'fresh', freshness_checked_at = v_now
  WHERE lifecycle_type = 'bid_discovered'
    AND archived_at IS NULL
    AND (freshness IS DISTINCT FROM 'fresh');

  -- date_bound: based on expiry_date
  UPDATE content_items
  SET freshness = CASE
    WHEN expiry_date IS NULL THEN 'aging'
    WHEN expiry_date < v_now THEN 'expired'
    WHEN expiry_date < v_now + interval '1 month' THEN 'stale'
    WHEN expiry_date < v_now + interval '3 months' THEN 'aging'
    ELSE 'fresh'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'date_bound'
    AND archived_at IS NULL;

  -- regulation: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 6 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 9 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE lifecycle_type = 'regulation'
    AND archived_at IS NULL;

  -- evergreen + null lifecycle_type: based on months since updated_at
  UPDATE content_items
  SET freshness = CASE
    WHEN updated_at IS NULL THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 12 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 18 THEN 'aging'
    WHEN EXTRACT(EPOCH FROM (v_now - updated_at)) / 2592000 < 24 THEN 'stale'
    ELSE 'expired'
  END,
  freshness_checked_at = v_now
  WHERE (lifecycle_type = 'evergreen' OR lifecycle_type IS NULL)
    AND archived_at IS NULL;

  -- Count final states (excluding archived)
  SELECT COUNT(*) FILTER (WHERE freshness = 'fresh'),
         COUNT(*) FILTER (WHERE freshness = 'aging'),
         COUNT(*) FILTER (WHERE freshness = 'stale'),
         COUNT(*) FILTER (WHERE freshness = 'expired'),
         COUNT(*)
  INTO v_fresh, v_aging, v_stale, v_expired, v_total
  FROM content_items
  WHERE archived_at IS NULL;

  RETURN QUERY SELECT v_total, v_fresh, v_aging, v_stale, v_expired;
END;
$$;

-- 4. Add find_duplicate_pairs RPC
CREATE OR REPLACE FUNCTION find_duplicate_pairs(
  similarity_threshold NUMERIC DEFAULT 0.95,
  limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
  id1 UUID,
  title1 TEXT,
  id2 UUID,
  title2 TEXT,
  similarity NUMERIC
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci1.id AS id1,
    COALESCE(ci1.title, ci1.suggested_title) AS title1,
    ci2.id AS id2,
    COALESCE(ci2.title, ci2.suggested_title) AS title2,
    (1 - (ci1.embedding <=> ci2.embedding))::NUMERIC(4, 3) AS similarity
  FROM content_items ci1
  CROSS JOIN content_items ci2
  WHERE ci1.id < ci2.id
    AND ci1.archived_at IS NULL
    AND ci2.archived_at IS NULL
    AND ci1.embedding IS NOT NULL
    AND ci2.embedding IS NOT NULL
    AND (1 - (ci1.embedding <=> ci2.embedding)) > similarity_threshold
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;

