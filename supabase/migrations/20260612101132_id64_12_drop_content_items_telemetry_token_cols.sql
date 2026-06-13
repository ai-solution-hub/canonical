-- {64.12} Drop 5 AI-telemetry token columns (0 writers anywhere; sole reader item-provenance.ts rewritten). bl-189 Part A.
ALTER TABLE content_items
  DROP COLUMN classification_tokens_in,
  DROP COLUMN classification_tokens_out,
  DROP COLUMN classification_cache_creation_tokens,
  DROP COLUMN classification_cache_read_tokens,
  DROP COLUMN embedding_tokens;
