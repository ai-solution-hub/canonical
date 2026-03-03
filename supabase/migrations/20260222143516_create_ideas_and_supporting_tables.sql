
-- Ideas table
CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  content TEXT NOT NULL,
  parent_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL,
  source_url TEXT,
  source_author VARCHAR(255),
  source_title VARCHAR(500),
  source_content_item_id UUID REFERENCES content_items(id) ON DELETE SET NULL,
  captured_date TIMESTAMP WITH TIME ZONE,
  primary_domain VARCHAR(50),
  primary_subtopic VARCHAR(50),
  secondary_domain VARCHAR(50),
  secondary_subtopic VARCHAR(50),
  classification_confidence NUMERIC(3, 2),
  classified_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(30) DEFAULT 'capturing',
  priority VARCHAR(20),
  relevance_score NUMERIC(3, 1) CHECK (relevance_score >= 0 AND relevance_score <= 10),
  implementation_complexity VARCHAR(20),
  estimated_effort_hours NUMERIC(8, 1),
  target_timeline VARCHAR(50),
  ai_summary TEXT,
  ai_keywords TEXT[],
  ai_themes TEXT[],
  embedding vector(1024),
  tana_node_id VARCHAR(100),
  tana_synced_at TIMESTAMP WITH TIME ZONE,
  tana_sync_hash VARCHAR(64),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT ideas_non_empty_content CHECK (length(trim(content)) > 0),
  CONSTRAINT ideas_valid_confidence CHECK (
    classification_confidence >= 0 AND classification_confidence <= 1
  )
);

-- Ideas indexes
CREATE INDEX IF NOT EXISTS idx_ideas_parent_id ON ideas(parent_id);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_primary_domain ON ideas(primary_domain);
CREATE INDEX IF NOT EXISTS idx_ideas_primary_subtopic ON ideas(primary_subtopic);
CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority);
CREATE INDEX IF NOT EXISTS idx_ideas_captured_date ON ideas(captured_date DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_created_at ON ideas(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_tana_node_id ON ideas(tana_node_id);
CREATE INDEX IF NOT EXISTS idx_ideas_source_type ON ideas(source_type);
CREATE INDEX IF NOT EXISTS idx_ideas_source_content_item ON ideas(source_content_item_id);
CREATE INDEX IF NOT EXISTS idx_ideas_ai_keywords ON ideas USING gin(ai_keywords);
CREATE INDEX IF NOT EXISTS idx_ideas_ai_themes ON ideas USING gin(ai_themes);
CREATE INDEX IF NOT EXISTS idx_ideas_embedding ON ideas
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE ideas IS 'Hierarchical idea storage with parent-child relationships, classification, and embeddings';
COMMENT ON COLUMN ideas.parent_id IS 'Self-referential: NULL for root ideas, set for sub-points';
COMMENT ON COLUMN ideas.source_type IS 'Provenance: onenote, samsung-notes, email, manual, linkedin, voice, conversation';
COMMENT ON COLUMN ideas.source_content_item_id IS 'FK to content_items if idea was derived from a content item';
COMMENT ON COLUMN ideas.tana_node_id IS 'Tana node reference for ideas-only sync';
COMMENT ON COLUMN ideas.embedding IS 'OpenAI text-embedding-3-large shortened to 1024 dimensions';

-- Idea Relationships table
CREATE TABLE IF NOT EXISTS idea_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  related_idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  relationship_type VARCHAR(50) NOT NULL,
  strength NUMERIC(3, 1) DEFAULT 1.0 CHECK (strength >= 0 AND strength <= 1),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(idea_id, related_idea_id, relationship_type),
  CONSTRAINT idea_relationships_not_self_referential CHECK (idea_id != related_idea_id)
);

CREATE INDEX IF NOT EXISTS idx_idea_relationships_type ON idea_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_idea_relationships_related_id ON idea_relationships(related_idea_id);
CREATE INDEX IF NOT EXISTS idx_idea_relationships_strength ON idea_relationships(strength);

-- Idea Keywords table
CREATE TABLE IF NOT EXISTS idea_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  keyword VARCHAR(100) NOT NULL,
  keyword_lower VARCHAR(100) GENERATED ALWAYS AS (LOWER(keyword)) STORED,
  relevance_score NUMERIC(3, 1) DEFAULT 1.0 CHECK (relevance_score >= 0 AND relevance_score <= 10),
  is_user_added BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(idea_id, keyword_lower)
);

CREATE INDEX IF NOT EXISTS idx_idea_keywords_keyword ON idea_keywords(keyword_lower);
CREATE INDEX IF NOT EXISTS idx_idea_keywords_relevance ON idea_keywords(relevance_score DESC);

-- Idea Themes table
CREATE TABLE IF NOT EXISTS idea_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7),
  icon VARCHAR(50),
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(name)
);

-- Idea Theme Assignments (junction table)
CREATE TABLE IF NOT EXISTS idea_theme_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES idea_themes(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(idea_id, theme_id)
);

-- Tana Sync Log
CREATE TABLE IF NOT EXISTS tana_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synced_idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL,
  tana_node_id VARCHAR(100),
  sync_direction VARCHAR(20) DEFAULT 'tana_to_supabase',
  sync_status VARCHAR(20),
  error_message TEXT,
  nodes_synced INTEGER,
  sync_duration_ms INTEGER,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tana_sync_log_tana_node_id ON tana_sync_log(tana_node_id);
CREATE INDEX IF NOT EXISTS idx_tana_sync_log_sync_status ON tana_sync_log(sync_status);
CREATE INDEX IF NOT EXISTS idx_tana_sync_log_synced_at ON tana_sync_log(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_tana_sync_log_idea_id ON tana_sync_log(synced_idea_id);

-- Ingestion Quality Log
CREATE TABLE IF NOT EXISTS ingestion_quality_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
  flag_type VARCHAR(50) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'warning',
  details JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(50),
  resolution_notes TEXT,
  ingestion_batch VARCHAR(100),
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT quality_log_valid_severity CHECK (severity IN ('info', 'warning', 'error')),
  CONSTRAINT quality_log_valid_flag_type CHECK (
    flag_type IN ('missing_thumbnail', 'short_content', 'missing_date', 'duplicate_candidate', 'scrape_failed', 'encoding_issue', 'missing_author', 'classification_low', 'manual_review')
  )
);

CREATE INDEX IF NOT EXISTS idx_quality_log_content_item ON ingestion_quality_log(content_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_log_flag_type ON ingestion_quality_log(flag_type);
CREATE INDEX IF NOT EXISTS idx_quality_log_resolved ON ingestion_quality_log(resolved);
CREATE INDEX IF NOT EXISTS idx_quality_log_severity ON ingestion_quality_log(severity);
CREATE INDEX IF NOT EXISTS idx_quality_log_created_at ON ingestion_quality_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_log_unresolved ON ingestion_quality_log(severity, created_at DESC) WHERE resolved = false;

COMMENT ON TABLE idea_relationships IS 'Graph relationships between ideas';
COMMENT ON TABLE idea_keywords IS 'Flexible tagging system for ideas';
COMMENT ON TABLE idea_themes IS 'User-created themes for organizing ideas';
COMMENT ON TABLE idea_theme_assignments IS 'Pivot table linking ideas to themes';
COMMENT ON TABLE tana_sync_log IS 'Audit trail for Tana-to-Supabase sync (ideas only)';
COMMENT ON TABLE ingestion_quality_log IS 'Data quality flags raised during content ingestion';
