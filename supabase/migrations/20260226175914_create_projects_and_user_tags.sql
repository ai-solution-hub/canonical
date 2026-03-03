-- Projects table (mirrors idea_themes pattern)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'folder',
  tana_node_id VARCHAR(100),
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Junction table for content_items <-> projects many-to-many
CREATE TABLE content_item_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_item_id, project_id)
);

CREATE INDEX idx_cip_content_item ON content_item_projects(content_item_id);
CREATE INDEX idx_cip_project ON content_item_projects(project_id);

-- User tags: lightweight informal labels, separate from ai_keywords
ALTER TABLE content_items ADD COLUMN user_tags TEXT[] DEFAULT '{}';
CREATE INDEX idx_content_items_user_tags ON content_items USING gin(user_tags);

-- RLS (permissive, single-user system)
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_item_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on projects" ON projects FOR ALL USING (true);
CREATE POLICY "Allow all on content_item_projects" ON content_item_projects FOR ALL USING (true);

-- RPC: get projects for an item
CREATE OR REPLACE FUNCTION get_item_projects(p_item_id UUID)
RETURNS SETOF projects
LANGUAGE sql STABLE
AS $$
  SELECT p.*
  FROM projects p
  JOIN content_item_projects cip ON cip.project_id = p.id
  WHERE cip.content_item_id = p_item_id
  AND p.is_archived = false
  ORDER BY p.name;
$$;

-- RPC: get project counts for browse filter
CREATE OR REPLACE FUNCTION get_project_counts()
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    jsonb_object_agg(name, cnt),
    '{}'::jsonb
  )
  FROM (
    SELECT p.name, COUNT(*) as cnt
    FROM content_item_projects cip
    JOIN projects p ON p.id = cip.project_id
    WHERE p.is_archived = false
    GROUP BY p.name
    ORDER BY cnt DESC
  ) sub;
$$;

-- RPC: get all unique user tags with counts
CREATE OR REPLACE FUNCTION get_user_tag_counts()
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    jsonb_object_agg(tag, cnt),
    '{}'::jsonb
  )
  FROM (
    SELECT tag, COUNT(*) as cnt
    FROM content_items ci, unnest(ci.user_tags) AS tag
    WHERE user_tags IS NOT NULL AND user_tags != '{}'
    GROUP BY tag
    ORDER BY cnt DESC
  ) sub;
$$;
