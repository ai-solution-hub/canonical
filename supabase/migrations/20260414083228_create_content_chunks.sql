-- Create content_chunks table for heading-based content chunking.
-- Each content_item can have 0..N chunks split at heading boundaries.
-- Per-chunk embeddings enable fine-grained semantic search.

SET search_path TO public, extensions;

CREATE TABLE content_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  heading_text text,                         -- NULL for preamble chunk (content before first heading)
  heading_level smallint,                    -- 1-6, NULL for preamble
  heading_path text[] NOT NULL DEFAULT '{}', -- breadcrumb: ['Health & Safety', 'Risk Assessment']
  content text NOT NULL,                     -- chunk body (includes the heading line itself)
  position smallint NOT NULL,                -- 0-based ordinal within parent document
  parent_chunk_id uuid REFERENCES content_chunks(id) ON DELETE CASCADE,
  embedding vector(1024),                    -- per-chunk embedding (text-embedding-3-large)
  char_count integer NOT NULL DEFAULT 0,
  word_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- B-tree indexes
CREATE INDEX idx_content_chunks_item ON content_chunks(content_item_id);
CREATE INDEX idx_content_chunks_parent ON content_chunks(parent_chunk_id)
  WHERE parent_chunk_id IS NOT NULL;
CREATE INDEX idx_content_chunks_heading ON content_chunks(heading_text)
  WHERE heading_text IS NOT NULL;

-- Vector index for chunk-level semantic search.
-- HNSW chosen over IVFFlat to match content_items pattern:
--   content_items uses: HNSW (m=16, ef_construction=64) vector_cosine_ops
--   (see migration 20260326164302_security_performance_fixes.sql line 3382)
-- HNSW has better recall at low row counts (chunks will start small).
CREATE INDEX idx_content_chunks_embedding ON content_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RLS: mirrors content_items policies exactly.
-- content_items policies (from migration 20260326164302):
--   SELECT: all authenticated users
--   INSERT: admin + editor
--   UPDATE: admin + editor
--   DELETE: admin only
ALTER TABLE content_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_chunks_select"
  ON content_chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "content_chunks_insert"
  ON content_chunks FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role() = ANY (ARRAY['admin'::text, 'editor'::text]));

CREATE POLICY "content_chunks_update"
  ON content_chunks FOR UPDATE
  TO authenticated
  USING (get_user_role() = ANY (ARRAY['admin'::text, 'editor'::text]));

CREATE POLICY "content_chunks_delete"
  ON content_chunks FOR DELETE
  TO authenticated
  USING (get_user_role() = 'admin'::text);

-- RPC function for chunk-level semantic search.
-- Simpler than hybrid_search: pure vector similarity + optional parent item filter.
-- Returns chunk data joined with parent item metadata for context.
CREATE OR REPLACE FUNCTION search_content_chunks(
  query_embedding vector,
  similarity_threshold numeric DEFAULT 0.3,
  limit_count integer DEFAULT 20,
  filter_content_item_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  content_item_id uuid,
  item_title text,
  item_suggested_title text,
  item_content_type text,
  item_primary_domain text,
  item_primary_subtopic text,
  heading_text text,
  heading_level smallint,
  heading_path text[],
  content text,
  "position" smallint,
  char_count integer,
  word_count integer,
  similarity numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id AS chunk_id,
    cc.content_item_id,
    ci.title AS item_title,
    ci.suggested_title AS item_suggested_title,
    ci.content_type::text AS item_content_type,
    ci.primary_domain::text AS item_primary_domain,
    ci.primary_subtopic::text AS item_primary_subtopic,
    cc.heading_text,
    cc.heading_level,
    cc.heading_path,
    cc.content,
    cc.position AS "position",
    cc.char_count,
    cc.word_count,
    (1 - (cc.embedding <=> query_embedding))::NUMERIC(4, 3) AS similarity
  FROM content_chunks cc
  JOIN content_items ci ON ci.id = cc.content_item_id
  WHERE cc.embedding IS NOT NULL
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (1 - (cc.embedding <=> query_embedding)) > similarity_threshold
    AND (filter_content_item_id IS NULL OR cc.content_item_id = filter_content_item_id)
  ORDER BY similarity DESC
  LIMIT limit_count;
END;
$$;
