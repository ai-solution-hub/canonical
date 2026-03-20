-- Migration: create_source_documents_table
-- Phase 3 of Content Lifecycle spec — source document version tracking

-- 1. Create source_documents table
CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document identity
  filename text NOT NULL,
  original_filename text NOT NULL,
  mime_type varchar NOT NULL,
  file_size int NOT NULL,

  -- Fingerprint for re-upload detection
  content_hash text NOT NULL,         -- MD5 of raw file bytes

  -- Version tracking
  version int NOT NULL DEFAULT 1,
  parent_id uuid REFERENCES source_documents(id) ON DELETE SET NULL,
  -- parent_id points to the previous version of the same logical document

  -- Storage
  storage_path text NOT NULL,         -- Supabase Storage path

  -- Processing
  status varchar NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
  extracted_text text,                 -- Full extracted text (for diffing)
  extraction_metadata jsonb DEFAULT '{}'::jsonb,

  -- Context
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  pipeline_run_id uuid REFERENCES pipeline_runs(id) ON DELETE SET NULL,

  -- Audit
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Soft delete
  archived_at timestamptz,
  archived_by uuid
);

-- Index for re-upload detection (same filename from same user)
CREATE INDEX idx_source_documents_filename_uploaded_by
  ON source_documents (filename, uploaded_by);

-- Index for content hash dedup
CREATE INDEX idx_source_documents_content_hash
  ON source_documents (content_hash);

-- Index for version chain traversal
CREATE INDEX idx_source_documents_parent_id
  ON source_documents (parent_id)
  WHERE parent_id IS NOT NULL;

COMMENT ON TABLE source_documents IS
  'Tracks uploaded source documents with version history. Each row is a specific version of a document. The parent_id chain links versions together.';

-- 2. Add source_document_id FK on content_items
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS source_document_id uuid
    REFERENCES source_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_content_items_source_document_id
  ON content_items (source_document_id)
  WHERE source_document_id IS NOT NULL;

COMMENT ON COLUMN content_items.source_document_id IS
  'FK to the source_documents row that produced this content item. Used for lineage tracking and re-ingestion diffing.';

-- 3. Expand notification entity types to include source_document
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_entity_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_entity_type_check CHECK (
    entity_type = ANY (ARRAY[
      'content_item'::text,
      'digest'::text,
      'template_requirement'::text,
      'domain'::text,
      'source_document'::text
    ])
  );

-- 4. RLS policies for source_documents
ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Authenticated users can view source documents"
  ON source_documents FOR SELECT
  TO authenticated
  USING (true);

-- Editor + Admin can insert
CREATE POLICY "Editors and admins can create source documents"
  ON source_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) IN ('editor', 'admin')
  );

-- Editor + Admin can update
CREATE POLICY "Editors and admins can update source documents"
  ON source_documents FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) IN ('editor', 'admin')
  );

-- Admin only can delete
CREATE POLICY "Admins can delete source documents"
  ON source_documents FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin'
  );

-- 5. RPC to get document version chain
CREATE OR REPLACE FUNCTION get_document_version_chain(p_document_id uuid)
RETURNS TABLE (
  id uuid,
  filename text,
  original_filename text,
  mime_type varchar,
  file_size int,
  content_hash text,
  version int,
  parent_id uuid,
  storage_path text,
  status varchar,
  uploaded_by uuid,
  created_at timestamptz,
  content_item_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- Walk up the chain to find the root document
  WITH RECURSIVE chain AS (
    -- Start from the given document
    SELECT sd.* FROM source_documents sd WHERE sd.id = p_document_id
    UNION ALL
    -- Walk to parent
    SELECT sd.* FROM source_documents sd
    JOIN chain c ON sd.id = c.parent_id
  ),
  -- Also walk down the chain from root to find all descendants
  root AS (
    SELECT id FROM chain WHERE parent_id IS NULL
    LIMIT 1
  ),
  full_chain AS (
    SELECT sd.* FROM source_documents sd
    WHERE sd.id = (SELECT id FROM root)
    UNION ALL
    SELECT sd.* FROM source_documents sd
    JOIN full_chain fc ON sd.parent_id = fc.id
  )
  SELECT
    fc.id,
    fc.filename,
    fc.original_filename,
    fc.mime_type,
    fc.file_size,
    fc.content_hash,
    fc.version,
    fc.parent_id,
    fc.storage_path,
    fc.status,
    fc.uploaded_by,
    fc.created_at,
    (SELECT count(*) FROM content_items ci WHERE ci.source_document_id = fc.id) AS content_item_count
  FROM full_chain fc
  ORDER BY fc.version ASC;
$$;

-- 6. RPC to detect re-uploads (matching filename from same user)
CREATE OR REPLACE FUNCTION detect_reupload(
  p_filename text,
  p_uploaded_by uuid,
  p_content_hash text
)
RETURNS TABLE (
  match_type text,        -- 'identical' | 'new_version' | 'none'
  existing_document_id uuid,
  existing_version int,
  existing_content_hash text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    CASE
      WHEN sd.content_hash = p_content_hash THEN 'identical'
      ELSE 'new_version'
    END AS match_type,
    sd.id AS existing_document_id,
    sd.version AS existing_version,
    sd.content_hash AS existing_content_hash
  FROM source_documents sd
  WHERE sd.filename = p_filename
    AND sd.uploaded_by = p_uploaded_by
    AND sd.archived_at IS NULL
  ORDER BY sd.version DESC
  LIMIT 1;
$$;
