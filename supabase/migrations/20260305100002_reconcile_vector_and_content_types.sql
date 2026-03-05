-- C3: Migration reconciliation — document actual live state
--
-- Earlier migrations (20260304100000, 20260304100001) defined:
--   - embedding as vector(1536) with ivfflat index
--   - content_type CHECK with only 15 types
--
-- The live DB has been updated to:
--   - embedding as vector(1024) — OpenAI text-embedding-3-large shortened via Matryoshka
--   - HNSW index (m=16, ef_construction=64, cosine) — better recall than ivfflat
--   - content_type CHECK with 23 types (15 original + 8 KB types)
--   - RPC functions use untyped vector parameters (compatible with any dimension)
--
-- This migration ensures a fresh deployment from migrations would match live state.

-- Step 1: Ensure embedding column is vector(1024), not vector(1536)
-- This is idempotent — if already 1024, ALTER is a no-op type-wise
DO $$
BEGIN
  -- Check if the column dimension needs changing
  IF (SELECT atttypmod FROM pg_attribute
      WHERE attrelid = 'public.content_items'::regclass AND attname = 'embedding') != 1024
  THEN
    -- Drop the index first (references the column type)
    DROP INDEX IF EXISTS idx_content_items_embedding;
    -- Alter column to correct dimension
    ALTER TABLE content_items ALTER COLUMN embedding TYPE vector(1024);
    -- Recreate HNSW index
    CREATE INDEX idx_content_items_embedding
      ON content_items USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64);
  END IF;
END $$;

-- Step 2: Ensure HNSW index exists (in case it was dropped above or missing)
CREATE INDEX IF NOT EXISTS idx_content_items_embedding
  ON content_items USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Step 3: Update content_type CHECK to KB-relevant types only
-- Remove IMS-era types: post, product-page, podcast, video, comment,
-- newsletter, bookmark, transcript, course
-- Keep: article, blog, pdf, note, research, other (general)
-- Keep: q_a_pair, case_study, policy, certification, compliance,
--        methodology, capability, product_description (KB types)

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_valid_content_type;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_valid_content_type
  CHECK (
    (content_type)::text = ANY ((ARRAY[
      'article'::character varying,
      'blog'::character varying,
      'pdf'::character varying,
      'note'::character varying,
      'research'::character varying,
      'other'::character varying,
      'q_a_pair'::character varying,
      'case_study'::character varying,
      'policy'::character varying,
      'certification'::character varying,
      'compliance'::character varying,
      'methodology'::character varying,
      'capability'::character varying,
      'product_description'::character varying
    ])::text[])
  );
