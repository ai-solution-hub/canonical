
-- Views
CREATE OR REPLACE VIEW ideas_with_stats AS
SELECT
  i.id, i.title, i.content, i.parent_id, i.status, i.priority,
  i.primary_domain, i.primary_subtopic, i.source_type, i.captured_date,
  COUNT(DISTINCT ir.related_idea_id) as related_ideas_count,
  COUNT(DISTINCT ik.id) as keywords_count,
  COUNT(DISTINCT ita.theme_id) as themes_count,
  (SELECT COUNT(*) FROM ideas child WHERE child.parent_id = i.id) as child_ideas_count,
  i.created_at, i.updated_at
FROM ideas i
LEFT JOIN idea_relationships ir ON i.id = ir.idea_id
LEFT JOIN idea_keywords ik ON i.id = ik.idea_id
LEFT JOIN idea_theme_assignments ita ON i.id = ita.idea_id
GROUP BY i.id, i.title, i.content, i.parent_id, i.status, i.priority,
         i.primary_domain, i.primary_subtopic, i.source_type, i.captured_date,
         i.created_at, i.updated_at;

CREATE OR REPLACE VIEW content_items_overview AS
SELECT
  ci.id, ci.title, ci.content_type, ci.platform, ci.source_domain,
  ci.author_name, ci.primary_domain, ci.primary_subtopic, ci.captured_date,
  ci.classified_at IS NOT NULL as is_classified,
  ci.embedding IS NOT NULL as has_embedding,
  ci.thumbnail_url IS NOT NULL AND ci.thumbnail_url != '' as has_thumbnail,
  ci.created_at
FROM content_items ci;

CREATE OR REPLACE VIEW quality_issues_pending AS
SELECT
  ql.id, ql.flag_type, ql.severity, ql.source_url, ql.details,
  ql.ingestion_batch, ql.created_at,
  ci.title as content_title, ci.content_type, ci.platform
FROM ingestion_quality_log ql
LEFT JOIN content_items ci ON ql.content_item_id = ci.id
WHERE ql.resolved = false
ORDER BY
  CASE ql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
  ql.created_at DESC;

-- Functions
CREATE OR REPLACE FUNCTION find_similar_ideas(
  query_embedding vector(1024),
  similarity_threshold NUMERIC DEFAULT 0.5,
  limit_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID, title VARCHAR(500), content TEXT, similarity NUMERIC,
  status VARCHAR(30), primary_domain VARCHAR(50), source_type VARCHAR(50)
) AS $$
SELECT i.id, i.title, i.content,
  (1 - (i.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
  i.status, i.primary_domain, i.source_type
FROM ideas i
WHERE i.embedding IS NOT NULL
  AND (1 - (i.embedding <=> query_embedding)) > similarity_threshold
ORDER BY i.embedding <=> query_embedding
LIMIT limit_count;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION find_similar_content(
  query_embedding vector(1024),
  similarity_threshold NUMERIC DEFAULT 0.5,
  limit_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID, title TEXT, content TEXT, similarity NUMERIC,
  content_type VARCHAR(50), platform VARCHAR(30), author_name VARCHAR(255), source_domain VARCHAR(100)
) AS $$
SELECT ci.id, ci.title, ci.content,
  (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
  ci.content_type, ci.platform, ci.author_name, ci.source_domain
FROM content_items ci
WHERE ci.embedding IS NOT NULL
  AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
ORDER BY ci.embedding <=> query_embedding
LIMIT limit_count;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION find_similar_all(
  query_embedding vector(1024),
  similarity_threshold NUMERIC DEFAULT 0.5,
  limit_count INT DEFAULT 20
)
RETURNS TABLE (
  id UUID, title TEXT, content TEXT, similarity NUMERIC,
  source_table TEXT, primary_domain VARCHAR, item_type TEXT
) AS $$
(
  SELECT ci.id, ci.title, ci.content,
    (1 - (ci.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
    'content_items'::TEXT as source_table, ci.primary_domain, ci.content_type::TEXT as item_type
  FROM content_items ci
  WHERE ci.embedding IS NOT NULL
    AND (1 - (ci.embedding <=> query_embedding)) > similarity_threshold
)
UNION ALL
(
  SELECT i.id, i.title::TEXT, i.content,
    (1 - (i.embedding <=> query_embedding))::NUMERIC(4, 3) as similarity,
    'ideas'::TEXT as source_table, i.primary_domain, i.source_type::TEXT as item_type
  FROM ideas i
  WHERE i.embedding IS NOT NULL
    AND (1 - (i.embedding <=> query_embedding)) > similarity_threshold
)
ORDER BY similarity DESC
LIMIT limit_count;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION find_idea_dependencies(
  start_idea_id UUID,
  max_depth INT DEFAULT 5
)
RETURNS TABLE (
  idea_id UUID, title VARCHAR(500), content TEXT,
  dependency_depth INT, relationship_type VARCHAR(50)
) AS $$
WITH RECURSIVE dep_tree AS (
  SELECT r.related_idea_id as idea_id, i.title, i.content, 1 as depth,
    r.relationship_type, ARRAY[start_idea_id, r.related_idea_id] as path
  FROM idea_relationships r
  JOIN ideas i ON r.related_idea_id = i.id
  WHERE r.idea_id = start_idea_id AND r.relationship_type = 'depends_on'
  UNION ALL
  SELECT r.related_idea_id, i.title, i.content, t.depth + 1,
    r.relationship_type, t.path || r.related_idea_id
  FROM idea_relationships r
  JOIN ideas i ON r.related_idea_id = i.id
  JOIN dep_tree t ON r.idea_id = t.idea_id
  WHERE t.depth < max_depth
    AND NOT r.related_idea_id = ANY(t.path)
    AND r.relationship_type = 'depends_on'
)
SELECT idea_id, title, content, depth as dependency_depth, relationship_type
FROM dep_tree ORDER BY depth ASC, idea_id;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION get_idea_subtree(root_idea_id UUID)
RETURNS TABLE (
  id UUID, title VARCHAR(500), content TEXT, parent_id UUID,
  depth INT, status VARCHAR(30), primary_domain VARCHAR(50)
) AS $$
WITH RECURSIVE idea_tree AS (
  SELECT id, title, content, parent_id, 0 as depth, status, primary_domain, created_at
  FROM ideas WHERE id = root_idea_id
  UNION ALL
  SELECT i.id, i.title, i.content, i.parent_id, t.depth + 1, i.status, i.primary_domain, i.created_at
  FROM ideas i JOIN idea_tree t ON i.parent_id = t.id
  WHERE t.depth < 10
)
SELECT id, title, content, parent_id, depth, status, primary_domain
FROM idea_tree ORDER BY depth ASC, parent_id, created_at;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS update_content_items_updated_at ON content_items;
CREATE TRIGGER update_content_items_updated_at BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ideas_updated_at ON ideas;
CREATE TRIGGER update_ideas_updated_at BEFORE UPDATE ON ideas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_idea_relationships_updated_at ON idea_relationships;
CREATE TRIGGER update_idea_relationships_updated_at BEFORE UPDATE ON idea_relationships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_idea_themes_updated_at ON idea_themes;
CREATE TRIGGER update_idea_themes_updated_at BEFORE UPDATE ON idea_themes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_theme_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tana_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_quality_log ENABLE ROW LEVEL SECURITY;

-- Permissive policies
CREATE POLICY "content_items_all" ON content_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ideas_all" ON ideas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "idea_relationships_all" ON idea_relationships FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "idea_keywords_all" ON idea_keywords FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "idea_themes_all" ON idea_themes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "idea_theme_assignments_all" ON idea_theme_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "tana_sync_log_all" ON tana_sync_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "ingestion_quality_log_all" ON ingestion_quality_log FOR ALL USING (true) WITH CHECK (true);
