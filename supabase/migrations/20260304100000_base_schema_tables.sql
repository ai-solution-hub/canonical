-- =============================================================================
-- Migration 1: Base Schema Tables
-- =============================================================================
-- Applied remotely via Supabase MCP on 4 March 2026
--
-- Creates the foundational tables carried forward from IMS:
--   - content_items        (core content store with pgvector embeddings)
--   - projects             (generic containers for projects, bids, kb sections)
--   - content_item_projects (many-to-many junction)
--   - ingestion_quality_log (pipeline quality flags)
--   - read_marks           (per-user read tracking)
--   - digests              (saved digest snapshots)
--   - pipeline_runs        (ingestion pipeline execution log)
--
-- Also creates:
--   - update_updated_at_column() trigger function
--   - Indexes on all foreign keys, embeddings (ivfflat), and common filters
--   - Basic permissive RLS (replaced by role-based policies in migration 5)
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigger function (used by all tables with updated_at)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ ... $$;

-- content_items
CREATE TABLE content_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    body            TEXT,
    content_type    TEXT NOT NULL CHECK (content_type IN ('article','note','document','bookmark','q_a_pair','case_study','policy','methodology','cv','company_info')),
    platform        TEXT CHECK (platform IN ('web','email','manual','upload','extraction','other')),
    source_url      TEXT,
    author          TEXT,
    domain          TEXT,
    subdomain       TEXT,
    topics          TEXT[] DEFAULT '{}',
    keywords        TEXT[] DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    embedding       vector(1536),
    is_starred      BOOLEAN DEFAULT FALSE,
    quality_score   REAL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_content_items_updated_at
    BEFORE UPDATE ON content_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes on content_items
CREATE INDEX idx_content_items_content_type ON content_items(content_type);
CREATE INDEX idx_content_items_domain ON content_items(domain);
CREATE INDEX idx_content_items_created_at ON content_items(created_at DESC);
CREATE INDEX idx_content_items_is_starred ON content_items(is_starred) WHERE is_starred = TRUE;
CREATE INDEX idx_content_items_embedding ON content_items
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_content_items_topics ON content_items USING gin(topics);
CREATE INDEX idx_content_items_keywords ON content_items USING gin(keywords);
CREATE INDEX idx_content_items_metadata ON content_items USING gin(metadata);

-- projects
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    color       TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- content_item_projects (junction)
CREATE TABLE content_item_projects (
    content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (content_item_id, project_id)
);

-- ingestion_quality_log
CREATE TABLE ingestion_quality_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    flag_type       TEXT NOT NULL CHECK (flag_type IN ('duplicate','low_quality','missing_field','review_needed','stale','conflicting')),
    details         JSONB DEFAULT '{}',
    resolved        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quality_log_unresolved ON ingestion_quality_log(resolved) WHERE resolved = FALSE;
CREATE INDEX idx_quality_log_content_item ON ingestion_quality_log(content_item_id);

-- read_marks
CREATE TABLE read_marks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    read_at         TIMESTAMPTZ DEFAULT NOW()
);

-- digests
CREATE TABLE digests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    body        TEXT,
    item_ids    UUID[] DEFAULT '{}',
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- pipeline_runs
CREATE TABLE pipeline_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_name   TEXT NOT NULL,
    status          TEXT DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
    items_processed INTEGER DEFAULT 0,
    items_created   INTEGER DEFAULT 0,
    items_updated   INTEGER DEFAULT 0,
    items_skipped   INTEGER DEFAULT 0,
    error_log       JSONB DEFAULT '[]',
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- Enable RLS on all tables (policies defined in migration 5)
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_item_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_quality_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;
