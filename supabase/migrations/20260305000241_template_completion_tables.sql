-- =============================================================================
-- Migration: Template Completion Tables
-- =============================================================================
-- Applied remotely via Supabase MCP on 5 March 2026
--
-- Creates tables, indexes, RLS policies, functions, and storage bucket
-- for the Phase 7B template completion workflow.
--
-- New tables:
--   - templates              (uploaded template metadata)
--   - template_fields        (identified fields and their mappings)
--   - template_completions   (completed document versions)
--
-- New function:
--   - get_template_summary   (field/mapping/fill status counts)
--
-- New storage bucket:
--   - templates              (original + completed .docx + structure.json)
--
-- Modified:
--   - processing_queue       (added result JSONB column)
-- =============================================================================

-- ===========
-- templates
-- ===========

CREATE TABLE templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    filename        TEXT NOT NULL,
    storage_path    TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    mime_type       TEXT NOT NULL CHECK (mime_type IN (
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
    status          TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
        'uploaded',
        'analysing',
        'analysed',
        'analysis_failed',
        'filling',
        'completed',
        'fill_failed'
    )),
    field_count     INTEGER,
    mapped_count    INTEGER DEFAULT 0,
    structure_path  TEXT,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_templates_project ON templates(project_id);
CREATE INDEX idx_templates_status ON templates(status);

CREATE TRIGGER set_templates_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "templates_select" ON templates FOR SELECT
    TO authenticated USING (true);
CREATE POLICY "templates_insert" ON templates FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "templates_update" ON templates FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "templates_delete" ON templates FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- =================
-- template_fields
-- =================

CREATE TABLE template_fields (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    field_type          TEXT NOT NULL CHECK (field_type IN (
        'empty_cell',
        'placeholder',
        'highlighted'
    )),
    table_index         INTEGER,
    row_index           INTEGER,
    col_index           INTEGER,
    question_text       TEXT,
    section_name        TEXT,
    word_limit          INTEGER,
    placeholder_text    TEXT,
    question_id         UUID REFERENCES bid_questions(id) ON DELETE SET NULL,
    mapping_status      TEXT NOT NULL DEFAULT 'unreviewed' CHECK (mapping_status IN (
        'unreviewed',
        'confirmed',
        'rejected',
        'manual',
        'unmapped'
    )),
    mapping_confidence  REAL,
    fill_status         TEXT NOT NULL DEFAULT 'pending' CHECK (fill_status IN (
        'pending',
        'filled',
        'skipped',
        'failed'
    )),
    fill_error          TEXT,
    sequence            INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_fields_template ON template_fields(template_id);
CREATE INDEX idx_template_fields_question ON template_fields(question_id);
CREATE INDEX idx_template_fields_mapping ON template_fields(template_id, mapping_status);

CREATE TRIGGER set_template_fields_updated_at
    BEFORE UPDATE ON template_fields
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE template_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_fields_select" ON template_fields FOR SELECT
    TO authenticated USING (true);
CREATE POLICY "template_fields_insert" ON template_fields FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "template_fields_update" ON template_fields FOR UPDATE
    TO authenticated USING (get_user_role() IN ('admin', 'editor'));
CREATE POLICY "template_fields_delete" ON template_fields FOR DELETE
    TO authenticated USING (get_user_role() = 'admin');

-- ======================
-- template_completions
-- ======================

CREATE TABLE template_completions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    job_id          UUID REFERENCES processing_queue(id),
    storage_path    TEXT NOT NULL,
    fields_filled   INTEGER NOT NULL,
    fields_skipped  INTEGER DEFAULT 0,
    fields_failed   INTEGER DEFAULT 0,
    file_size       INTEGER,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_completions_template ON template_completions(template_id);

ALTER TABLE template_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_completions_select" ON template_completions FOR SELECT
    TO authenticated USING (true);
CREATE POLICY "template_completions_insert" ON template_completions FOR INSERT
    TO authenticated WITH CHECK (get_user_role() IN ('admin', 'editor'));

-- ========================================
-- processing_queue: add result column
-- ========================================

ALTER TABLE processing_queue
    ADD COLUMN IF NOT EXISTS result JSONB;

-- =============================
-- get_template_summary function
-- =============================

CREATE OR REPLACE FUNCTION get_template_summary(p_template_id UUID)
RETURNS TABLE (
    total_fields BIGINT,
    confirmed_fields BIGINT,
    rejected_fields BIGINT,
    unmapped_fields BIGINT,
    unreviewed_fields BIGINT,
    filled_fields BIGINT,
    pending_fields BIGINT,
    skipped_fields BIGINT,
    failed_fields BIGINT
) AS $$
    SELECT
        COUNT(*)::BIGINT AS total_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'confirmed' OR mapping_status = 'manual')::BIGINT AS confirmed_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'rejected')::BIGINT AS rejected_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'unmapped')::BIGINT AS unmapped_fields,
        COUNT(*) FILTER (WHERE mapping_status = 'unreviewed')::BIGINT AS unreviewed_fields,
        COUNT(*) FILTER (WHERE fill_status = 'filled')::BIGINT AS filled_fields,
        COUNT(*) FILTER (WHERE fill_status = 'pending')::BIGINT AS pending_fields,
        COUNT(*) FILTER (WHERE fill_status = 'skipped')::BIGINT AS skipped_fields,
        COUNT(*) FILTER (WHERE fill_status = 'failed')::BIGINT AS failed_fields
    FROM public.template_fields
    WHERE template_id = p_template_id;
$$ LANGUAGE SQL STABLE
SET search_path = public;

-- ============================
-- Storage bucket: templates
-- ============================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'templates',
    'templates',
    false,
    52428800,
    ARRAY[
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/json'
    ]
);

-- Storage RLS policies
CREATE POLICY "Authenticated users can upload templates"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'templates');

CREATE POLICY "Authenticated users can read templates"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'templates');

CREATE POLICY "Editors and admins can delete templates"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'templates' AND (SELECT get_user_role()) IN ('admin', 'editor'));

CREATE POLICY "Editors and admins can update templates"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'templates' AND (SELECT get_user_role()) IN ('admin', 'editor'));
