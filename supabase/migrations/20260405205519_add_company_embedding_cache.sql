-- Add cached company embedding to avoid regenerating on every pipeline run
-- Uses text type for JSON-serialised embedding (simpler than vector for cache-only column)
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS company_embedding text;

-- Add comment explaining the column purpose
COMMENT ON COLUMN company_profiles.company_embedding IS
  'JSON-serialised embedding vector for relevance pre-filter caching. Set to null when profile is updated to trigger re-generation.';
