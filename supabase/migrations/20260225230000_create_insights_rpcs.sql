-- Migration: Create insights RPC functions + keyword normalisation
-- Purpose: Powers the /insights page with analytical views over content_items

-- =============================================================================
-- 1. Keyword Normalisation (one-off data fix)
-- =============================================================================
-- Normalise ai_keywords to lowercase (fixes inconsistent casing like "ai agents" vs "AI agents")
UPDATE content_items
SET ai_keywords = (
  SELECT array_agg(DISTINCT lower(trim(kw)))
  FROM unnest(ai_keywords) AS kw
  WHERE trim(kw) != ''
)
WHERE ai_keywords IS NOT NULL;

-- =============================================================================
-- 2. get_trend_analysis(p_days, p_min_count)
-- =============================================================================
-- Returns trending keywords with counts and growth rate vs prior period
CREATE OR REPLACE FUNCTION get_trend_analysis(
  p_days INT DEFAULT 30,
  p_min_count INT DEFAULT 2
)
RETURNS TABLE (
  keyword TEXT,
  current_count BIGINT,
  previous_count BIGINT,
  growth_rate NUMERIC,
  domains TEXT[]
) AS $$
SELECT
  kw AS keyword,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS current_count,
  COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
                   AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) AS previous_count,
  CASE
    WHEN COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
                          AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL) = 0
    THEN NULL
    ELSE ROUND(
      (COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL)::NUMERIC -
       COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
                        AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC) /
      COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
                       AND ci.captured_date < NOW() - (p_days || ' days')::INTERVAL)::NUMERIC * 100, 1)
  END AS growth_rate,
  array_agg(DISTINCT ci.primary_domain) FILTER (WHERE ci.primary_domain IS NOT NULL
    AND ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) AS domains
FROM content_items ci,
  unnest(ci.ai_keywords) AS kw
WHERE ci.captured_date >= NOW() - (p_days * 2 || ' days')::INTERVAL
  AND ci.ai_keywords IS NOT NULL
GROUP BY kw
HAVING COUNT(*) FILTER (WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL) >= p_min_count
ORDER BY current_count DESC, growth_rate DESC NULLS LAST;
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 3. get_topic_deep_dive(p_keyword)
-- =============================================================================
-- Returns item count, domain distribution, top authors, timeline, co-occurring keywords
CREATE OR REPLACE FUNCTION get_topic_deep_dive(p_keyword TEXT)
RETURNS JSON AS $$
SELECT json_build_object(
  'keyword', p_keyword,
  'total_items', (
    SELECT COUNT(*) FROM content_items
    WHERE ai_keywords @> ARRAY[lower(p_keyword)]
  ),
  'domain_distribution', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT primary_domain, COUNT(*) AS cnt
      FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)] AND primary_domain IS NOT NULL
      GROUP BY primary_domain
    ) sub
  ),
  'top_authors', (
    SELECT json_agg(json_build_object('author', author_name, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT author_name, COUNT(*) AS cnt
      FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)]
        AND author_name IS NOT NULL AND author_name != ''
      GROUP BY author_name
      ORDER BY cnt DESC
      LIMIT 10
    ) sub
  ),
  'timeline', (
    SELECT json_agg(json_build_object('month', month, 'count', cnt) ORDER BY month DESC)
    FROM (
      SELECT date_trunc('month', captured_date) AS month, COUNT(*) AS cnt
      FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)]
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    ) sub
  ),
  'co_occurring_keywords', (
    SELECT json_agg(json_build_object('keyword', co_kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT kw AS co_kw, COUNT(*) AS cnt
      FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.ai_keywords @> ARRAY[lower(p_keyword)]
        AND kw != lower(p_keyword)
      GROUP BY kw
      ORDER BY cnt DESC
      LIMIT 15
    ) sub
  ),
  'recent_items', (
    SELECT json_agg(json_build_object(
      'id', id,
      'title', COALESCE(suggested_title, title),
      'content_type', content_type,
      'author_name', author_name,
      'captured_date', captured_date
    ) ORDER BY captured_date DESC)
    FROM (
      SELECT id, suggested_title, title, content_type, author_name, captured_date
      FROM content_items
      WHERE ai_keywords @> ARRAY[lower(p_keyword)]
      ORDER BY captured_date DESC
      LIMIT 10
    ) sub
  )
);
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 4. get_author_analysis(p_author_name)
-- =============================================================================
-- Returns item count, domains, confidence, topics, recent items for an author
CREATE OR REPLACE FUNCTION get_author_analysis(p_author_name TEXT)
RETURNS JSON AS $$
SELECT json_build_object(
  'author_name', p_author_name,
  'total_items', (
    SELECT COUNT(*) FROM content_items WHERE author_name ILIKE p_author_name
  ),
  'first_item', (
    SELECT MIN(captured_date) FROM content_items WHERE author_name ILIKE p_author_name
  ),
  'latest_item', (
    SELECT MAX(captured_date) FROM content_items WHERE author_name ILIKE p_author_name
  ),
  'avg_confidence', (
    SELECT ROUND(AVG(classification_confidence)::NUMERIC, 3) FROM content_items
    WHERE author_name ILIKE p_author_name AND classification_confidence IS NOT NULL
  ),
  'domain_breakdown', (
    SELECT json_agg(json_build_object('domain', primary_domain, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT primary_domain, COUNT(*) AS cnt
      FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_domain IS NOT NULL
      GROUP BY primary_domain
    ) sub
  ),
  'subtopic_breakdown', (
    SELECT json_agg(json_build_object('subtopic', primary_subtopic, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT primary_subtopic, COUNT(*) AS cnt
      FROM content_items
      WHERE author_name ILIKE p_author_name AND primary_subtopic IS NOT NULL
      GROUP BY primary_subtopic
    ) sub
  ),
  'top_keywords', (
    SELECT json_agg(json_build_object('keyword', kw, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT kw, COUNT(*) AS cnt
      FROM content_items ci, unnest(ci.ai_keywords) AS kw
      WHERE ci.author_name ILIKE p_author_name
      GROUP BY kw
      ORDER BY cnt DESC
      LIMIT 10
    ) sub
  ),
  'content_types', (
    SELECT json_agg(json_build_object('type', content_type, 'count', cnt) ORDER BY cnt DESC)
    FROM (
      SELECT content_type, COUNT(*) AS cnt
      FROM content_items
      WHERE author_name ILIKE p_author_name
      GROUP BY content_type
    ) sub
  ),
  'recent_items', (
    SELECT json_agg(json_build_object(
      'id', id,
      'title', COALESCE(suggested_title, title),
      'content_type', content_type,
      'captured_date', captured_date,
      'primary_subtopic', primary_subtopic
    ) ORDER BY captured_date DESC)
    FROM (
      SELECT id, suggested_title, title, content_type, captured_date, primary_subtopic
      FROM content_items
      WHERE author_name ILIKE p_author_name
      ORDER BY captured_date DESC
      LIMIT 5
    ) sub
  )
);
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 5. get_content_gaps()
-- =============================================================================
-- Returns domains/subtopics with few items or stale content
CREATE OR REPLACE FUNCTION get_content_gaps()
RETURNS JSON AS $$
SELECT json_build_object(
  'sparse_subtopics', (
    SELECT json_agg(json_build_object(
      'domain', primary_domain,
      'subtopic', primary_subtopic,
      'count', cnt,
      'latest', latest
    ) ORDER BY cnt ASC)
    FROM (
      SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt,
             MAX(captured_date) AS latest
      FROM content_items
      WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL
      GROUP BY primary_domain, primary_subtopic
      HAVING COUNT(*) < 5
    ) sub
  ),
  'stale_subtopics', (
    SELECT json_agg(json_build_object(
      'domain', primary_domain,
      'subtopic', primary_subtopic,
      'count', cnt,
      'latest', latest,
      'days_since', EXTRACT(DAY FROM NOW() - latest)::INT
    ) ORDER BY latest ASC)
    FROM (
      SELECT primary_domain, primary_subtopic, COUNT(*) AS cnt,
             MAX(captured_date) AS latest
      FROM content_items
      WHERE primary_domain IS NOT NULL AND primary_subtopic IS NOT NULL
      GROUP BY primary_domain, primary_subtopic
      HAVING MAX(captured_date) < NOW() - INTERVAL '30 days'
    ) sub
  ),
  'domain_summary', (
    SELECT json_agg(json_build_object(
      'domain', primary_domain,
      'total_items', cnt,
      'subtopic_count', subtopics,
      'latest', latest,
      'avg_confidence', avg_conf
    ) ORDER BY cnt DESC)
    FROM (
      SELECT primary_domain, COUNT(*) AS cnt,
             COUNT(DISTINCT primary_subtopic) AS subtopics,
             MAX(captured_date) AS latest,
             ROUND(AVG(classification_confidence)::NUMERIC, 3) AS avg_conf
      FROM content_items
      WHERE primary_domain IS NOT NULL
      GROUP BY primary_domain
    ) sub
  )
);
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 6. get_reading_patterns(p_days)
-- =============================================================================
-- Returns reading velocity, domain preferences, read vs unread analysis
CREATE OR REPLACE FUNCTION get_reading_patterns(p_days INT DEFAULT 30)
RETURNS JSON AS $$
SELECT json_build_object(
  'period_days', p_days,
  'total_items', (
    SELECT COUNT(*) FROM content_items
    WHERE captured_date >= NOW() - (p_days || ' days')::INTERVAL
  ),
  'items_read', (
    SELECT COUNT(DISTINCT rm.content_item_id)
    FROM read_marks rm
    JOIN content_items ci ON ci.id = rm.content_item_id
    WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  'reading_velocity', (
    SELECT ROUND(COUNT(DISTINCT rm.content_item_id)::NUMERIC / GREATEST(p_days, 1), 1)
    FROM read_marks rm
    WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL
  ),
  'domain_reading', (
    SELECT json_agg(json_build_object(
      'domain', domain,
      'total', total,
      'read', read_count,
      'read_pct', CASE WHEN total > 0 THEN ROUND(read_count::NUMERIC / total * 100, 1) ELSE 0 END
    ) ORDER BY total DESC)
    FROM (
      SELECT ci.primary_domain AS domain,
             COUNT(*) AS total,
             COUNT(rm.id) AS read_count
      FROM content_items ci
      LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL
        AND ci.primary_domain IS NOT NULL
      GROUP BY ci.primary_domain
    ) sub
  ),
  'type_reading', (
    SELECT json_agg(json_build_object(
      'type', content_type,
      'total', total,
      'read', read_count
    ) ORDER BY total DESC)
    FROM (
      SELECT ci.content_type,
             COUNT(*) AS total,
             COUNT(rm.id) AS read_count
      FROM content_items ci
      LEFT JOIN read_marks rm ON ci.id = rm.content_item_id
      WHERE ci.captured_date >= NOW() - (p_days || ' days')::INTERVAL
      GROUP BY ci.content_type
    ) sub
  ),
  'daily_reading', (
    SELECT json_agg(json_build_object(
      'date', read_date,
      'count', cnt
    ) ORDER BY read_date DESC)
    FROM (
      SELECT DATE(rm.read_at) AS read_date, COUNT(*) AS cnt
      FROM read_marks rm
      WHERE rm.read_at >= NOW() - (p_days || ' days')::INTERVAL
      GROUP BY DATE(rm.read_at)
      ORDER BY read_date DESC
    ) sub
  )
);
$$ LANGUAGE SQL STABLE;
