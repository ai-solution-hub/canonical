-- 20260526074944_id42_pullmd_provenance.sql
-- pullmd provenance schema — net-new source_documents columns + feed_articles CHECK extension
-- ID-42 (deploy pullmd + retire HTML extraction) — TECH §WP-D (docs/specs/id-42-pullmd-deploy/TECH.md)
-- Inv-8 (pullmd extraction_method recorded), Inv-9 (pullmd_share_id round-trips),
-- Inv-17 (existing feed_articles corpus not corrupted — additive CHECK, no prune).
-- ADD COLUMN-only; IF NOT EXISTS-guarded; CHECK redefinition is non-destructive (extends the
-- admitted set; pre-existing 'firecrawl' rows stay valid). No PL/pgSQL functions
-- (function-free → no REVOKE-anon needed). Mirrors the op_id precedent
-- (20260521203414_t8_op_id_propagation.sql).

SET search_path = public, extensions;

-- source_documents.pullmd_share_id (X-Share-Id permalink, 8-hex)
ALTER TABLE public.source_documents ADD COLUMN IF NOT EXISTS pullmd_share_id text NULL;
CREATE INDEX IF NOT EXISTS idx_source_documents_pullmd_share_id
  ON public.source_documents (pullmd_share_id) WHERE pullmd_share_id IS NOT NULL;
COMMENT ON COLUMN public.source_documents.pullmd_share_id IS
  'pullmd X-Share-Id permalink (GET /s/:id round-trips); ID-42 (docs/specs/id-42-pullmd-deploy/TECH.md WP-D)';

-- source_documents.extraction_method (typed column + CHECK enum)
ALTER TABLE public.source_documents ADD COLUMN IF NOT EXISTS extraction_method text NULL;
ALTER TABLE public.source_documents DROP CONSTRAINT IF EXISTS source_documents_extraction_method_check;
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_extraction_method_check
  CHECK (extraction_method IS NULL OR extraction_method = ANY (ARRAY[
    'rss_content','fetch','jina_reader','firecrawl','summary_fallback',
    'pullmd_readability','pullmd_playwright','pullmd_cloudflare','pullmd_reddit','pullmd_trafilatura','docling']));
COMMENT ON COLUMN public.source_documents.extraction_method IS
  'Extractor that produced the markdown; pullmd_* mirrors X-Source, docling for binary; ID-42';

-- feed_articles.extraction_method CHECK extension (MANDATORY — pipeline.ts:395/480 write it
-- unconditionally). Extend with pullmd_* + docling; NO destructive prune of firecrawl
-- (Ratified-S237 lockstep, T7-gated).
ALTER TABLE public.feed_articles DROP CONSTRAINT IF EXISTS feed_articles_extraction_method_check;
ALTER TABLE public.feed_articles ADD CONSTRAINT feed_articles_extraction_method_check
  CHECK (extraction_method IS NULL OR extraction_method = ANY (ARRAY[
    'rss_content','fetch','jina_reader','firecrawl','summary_fallback',
    'pullmd_readability','pullmd_playwright','pullmd_cloudflare','pullmd_reddit','pullmd_trafilatura','docling']));
