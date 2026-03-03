
-- Extensions
CREATE EXTENSION IF NOT EXISTS "vector";

-- Content Items table
CREATE TABLE IF NOT EXISTS content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  source_domain VARCHAR(100),
  thumbnail_url TEXT,
  content_type VARCHAR(50) NOT NULL DEFAULT 'post',
  platform VARCHAR(30) DEFAULT 'linkedin',
  parent_id UUID REFERENCES content_items(id) ON DELETE SET NULL,
  author_name VARCHAR(255),
  author_url TEXT,
  engagement_metrics JSONB,
  primary_domain VARCHAR(50),
  primary_subtopic VARCHAR(50),
  secondary_domain VARCHAR(50),
  secondary_subtopic VARCHAR(50),
  classification_confidence NUMERIC(3, 2),
  classified_at TIMESTAMP WITH TIME ZONE,
  ai_summary TEXT,
  ai_keywords TEXT[],
  embedding vector(1024),
  metadata JSONB DEFAULT '{}',
  captured_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT content_items_non_empty_title CHECK (length(trim(title)) > 0),
  CONSTRAINT content_items_valid_content_type CHECK (
    content_type IN ('post','article','pdf','product-page','podcast','video','comment','newsletter','bookmark','transcript','note','course','other')
  ),
  CONSTRAINT content_items_valid_platform CHECK (
    platform IN ('linkedin','reddit','youtube','web','email','manual','other')
  ),
  CONSTRAINT content_items_valid_confidence CHECK (
    classification_confidence >= 0 AND classification_confidence <= 1
  )
);

-- Indexes for content_items
CREATE INDEX IF NOT EXISTS idx_content_items_source_url ON content_items(source_url);
CREATE INDEX IF NOT EXISTS idx_content_items_source_domain ON content_items(source_domain);
CREATE INDEX IF NOT EXISTS idx_content_items_content_type ON content_items(content_type);
CREATE INDEX IF NOT EXISTS idx_content_items_platform ON content_items(platform);
CREATE INDEX IF NOT EXISTS idx_content_items_parent_id ON content_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_content_items_primary_domain ON content_items(primary_domain);
CREATE INDEX IF NOT EXISTS idx_content_items_primary_subtopic ON content_items(primary_subtopic);
CREATE INDEX IF NOT EXISTS idx_content_items_captured_date ON content_items(captured_date DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_created_at ON content_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_items_type_platform ON content_items(content_type, platform);
CREATE INDEX IF NOT EXISTS idx_content_items_ai_keywords ON content_items USING gin(ai_keywords);
CREATE INDEX IF NOT EXISTS idx_content_items_metadata ON content_items USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_content_items_embedding ON content_items
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE content_items IS 'Multi-source content items: posts, articles, PDFs, podcasts, and other knowledge artifacts from any platform';
COMMENT ON COLUMN content_items.content_type IS 'Format/nature of content: post, article, pdf, product-page, podcast, video, comment, newsletter, bookmark, transcript, note, course, other';
COMMENT ON COLUMN content_items.platform IS 'Discovery/capture channel: linkedin, reddit, youtube, web, email, manual, other';
COMMENT ON COLUMN content_items.source_domain IS 'Domain extracted from source_url for queryable filtering';
COMMENT ON COLUMN content_items.thumbnail_url IS 'Preview image URL for UI display';
COMMENT ON COLUMN content_items.parent_id IS 'Self-referential FK for multi-format content';
COMMENT ON COLUMN content_items.metadata IS 'Flexible JSONB for source-specific data';
COMMENT ON COLUMN content_items.embedding IS 'OpenAI text-embedding-3-large shortened to 1024 dimensions';
