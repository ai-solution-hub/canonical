-- =============================================================================
-- Migration 4: New Product Tables
-- =============================================================================
-- Applied remotely via Supabase MCP on 4 March 2026
--
-- Creates new tables required for knowledge-hub product features:
--   - user_roles           (RBAC: admin, editor, viewer per user)
--   - content_history      (version tracking with auto-increment trigger)
--   - bid_questions        (imported bid/tender questions)
--   - bid_responses        (AI-drafted + human-edited answers)
--   - taxonomy_domains     (managed domain taxonomy)
--   - taxonomy_subtopics   (managed subtopic taxonomy)
-- =============================================================================

-- ===========
-- user_roles
-- ===========

CREATE TABLE user_roles (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','editor','viewer')),
    granted_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE TRIGGER set_user_roles_updated_at
    BEFORE UPDATE ON user_roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- ================
-- content_history
-- ================

CREATE TABLE content_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,
    title           TEXT,
    body            TEXT,
    brief           TEXT,
    detail          TEXT,
    metadata        JSONB DEFAULT '{}',
    changed_by      UUID REFERENCES auth.users(id),
    changed_at      TIMESTAMPTZ DEFAULT NOW(),
    change_reason   TEXT,
    UNIQUE(content_item_id, version)
);

CREATE INDEX idx_content_history_item ON content_history(content_item_id, version DESC);

-- Auto-version trigger: assigns next version number on insert
CREATE OR REPLACE FUNCTION auto_version_content_history()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := COALESCE(
        (SELECT MAX(version) FROM content_history WHERE content_item_id = NEW.content_item_id),
        0
    ) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_content_history_version
    BEFORE INSERT ON content_history
    FOR EACH ROW EXECUTE FUNCTION auto_version_content_history();

ALTER TABLE content_history ENABLE ROW LEVEL SECURITY;

-- ==============
-- bid_questions
-- ==============

CREATE TABLE bid_questions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    question_number TEXT,
    question_text   TEXT NOT NULL,
    section         TEXT,
    word_limit      INTEGER,
    weighting       REAL,
    guidance_notes  TEXT,
    status          TEXT DEFAULT 'pending' CHECK (status IN (
        'pending','in_progress','drafted','reviewed','final','skipped'
    )),
    assigned_to     UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bid_questions_project ON bid_questions(project_id);
CREATE INDEX idx_bid_questions_status ON bid_questions(status);

CREATE TRIGGER set_bid_questions_updated_at
    BEFORE UPDATE ON bid_questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bid_questions ENABLE ROW LEVEL SECURITY;

-- ==============
-- bid_responses
-- ==============

CREATE TABLE bid_responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id     UUID NOT NULL REFERENCES bid_questions(id) ON DELETE CASCADE,
    version         INTEGER DEFAULT 1,
    body            TEXT,
    source_items    UUID[] DEFAULT '{}',  -- content_item IDs used as evidence
    ai_confidence   REAL,
    drafted_by      TEXT CHECK (drafted_by IN ('ai','human','hybrid')),
    edited_by       UUID REFERENCES auth.users(id),
    status          TEXT DEFAULT 'draft' CHECK (status IN (
        'draft','review','approved','exported'
    )),
    feedback        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bid_responses_question ON bid_responses(question_id, version DESC);

CREATE TRIGGER set_bid_responses_updated_at
    BEFORE UPDATE ON bid_responses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bid_responses ENABLE ROW LEVEL SECURITY;

-- ==================
-- taxonomy_domains
-- ==================

CREATE TABLE taxonomy_domains (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE taxonomy_domains ENABLE ROW LEVEL SECURITY;

-- ====================
-- taxonomy_subtopics
-- ====================

CREATE TABLE taxonomy_subtopics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain_id   UUID NOT NULL REFERENCES taxonomy_domains(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    sort_order  INTEGER DEFAULT 0,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(domain_id, name)
);

CREATE INDEX idx_taxonomy_subtopics_domain ON taxonomy_subtopics(domain_id);

ALTER TABLE taxonomy_subtopics ENABLE ROW LEVEL SECURITY;
