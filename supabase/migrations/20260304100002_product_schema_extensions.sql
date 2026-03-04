-- =============================================================================
-- Migration 3: Product Schema Extensions
-- =============================================================================
-- Applied remotely via Supabase MCP on 4 March 2026
--
-- Extends the IMS base schema for knowledge-hub product requirements:
--   - Adds ownership columns (created_by, updated_by) to content_items
--   - Adds content structure columns (brief, detail, reference)
--   - Adds provenance columns (source_document, source_bid)
--   - Adds freshness tracking (last_validated_at, validation_status)
--   - Drops IMS-specific columns no longer needed
--   - Updates CHECK constraints for product content types and platforms
--   - Extends projects table (type, domain_metadata; drops tana_node_id)
--   - Updates ingestion_quality_log flag types
--   - Adds user_id to read_marks
--   - Drops share columns from digests
--   - Creates processing_queue table for Python worker
-- =============================================================================

-- =====================
-- content_items changes
-- =====================

-- Ownership
ALTER TABLE content_items ADD COLUMN created_by UUID REFERENCES auth.users(id);
ALTER TABLE content_items ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Content structure: three-tier content model
ALTER TABLE content_items ADD COLUMN brief TEXT;    -- 1-2 sentence summary
ALTER TABLE content_items ADD COLUMN detail TEXT;   -- extended explanation
ALTER TABLE content_items ADD COLUMN reference TEXT; -- source references / citations

-- Provenance: where this content was extracted from
ALTER TABLE content_items ADD COLUMN source_document UUID REFERENCES content_items(id);
ALTER TABLE content_items ADD COLUMN source_bid UUID REFERENCES projects(id);

-- Freshness tracking
ALTER TABLE content_items ADD COLUMN last_validated_at TIMESTAMPTZ;
ALTER TABLE content_items ADD COLUMN validation_status TEXT DEFAULT 'current'
    CHECK (validation_status IN ('current','needs_review','outdated','archived'));

-- Drop IMS-specific columns
ALTER TABLE content_items DROP COLUMN IF EXISTS engagement_metrics;
ALTER TABLE content_items DROP COLUMN IF EXISTS author_url;
ALTER TABLE content_items DROP COLUMN IF EXISTS segments;
ALTER TABLE content_items DROP COLUMN IF EXISTS highlights;

-- Update content_type constraint
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_content_type_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_content_type_check
    CHECK (content_type IN (
        'article','note','document','bookmark',
        'q_a_pair','case_study','policy','methodology','cv','company_info'
    ));

-- Update platform constraint
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_platform_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_platform_check
    CHECK (platform IN ('web','email','manual','upload','extraction','other'));

-- Index on created_by for ownership queries
CREATE INDEX idx_content_items_created_by ON content_items(created_by);
CREATE INDEX idx_content_items_validation_status ON content_items(validation_status);

-- ================
-- projects changes
-- ================

-- Add type discriminator for generic containers
ALTER TABLE projects ADD COLUMN type TEXT DEFAULT 'project'
    CHECK (type IN ('project','bid','kb_section'));

-- Add structured metadata for domain-specific config
ALTER TABLE projects ADD COLUMN domain_metadata JSONB DEFAULT '{}';

-- Drop IMS-specific column
ALTER TABLE projects DROP COLUMN IF EXISTS tana_node_id;

CREATE INDEX idx_projects_type ON projects(type);

-- =============================
-- ingestion_quality_log changes
-- =============================

-- Update flag_type to include product-specific flags
ALTER TABLE ingestion_quality_log DROP CONSTRAINT IF EXISTS ingestion_quality_log_flag_type_check;
ALTER TABLE ingestion_quality_log ADD CONSTRAINT ingestion_quality_log_flag_type_check
    CHECK (flag_type IN (
        'duplicate','low_quality','missing_field','review_needed',
        'stale','conflicting'
    ));

-- =================
-- read_marks changes
-- =================

-- Add user_id for multi-user read tracking
ALTER TABLE read_marks ADD COLUMN user_id UUID REFERENCES auth.users(id);
CREATE INDEX idx_read_marks_user ON read_marks(user_id);

-- ===============
-- digests changes
-- ===============

-- Drop IMS share columns (no longer needed)
ALTER TABLE digests DROP COLUMN IF EXISTS share_id;
ALTER TABLE digests DROP COLUMN IF EXISTS shared_at;
ALTER TABLE digests DROP COLUMN IF EXISTS share_expires_at;

-- ================
-- processing_queue
-- ================

-- Queue table for Python worker service
CREATE TABLE processing_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type       TEXT NOT NULL CHECK (task_type IN (
        'embed','classify','extract_qa','summarise','validate','reprocess'
    )),
    payload         JSONB NOT NULL DEFAULT '{}',
    status          TEXT DEFAULT 'pending' CHECK (status IN (
        'pending','processing','completed','failed','cancelled'
    )),
    priority        INTEGER DEFAULT 0,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_processing_queue_status ON processing_queue(status, priority DESC, created_at);
CREATE INDEX idx_processing_queue_task_type ON processing_queue(task_type);

ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;
