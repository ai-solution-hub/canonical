-- ID-112.8 — In-house extraction provenance (PI-10)
--
-- Append-only extension of the extraction_method CHECK constraints on
-- public.source_documents and public.feed_articles to admit the three
-- in-house extractor labels introduced by the HTML/URL extraction cutover:
--   trafilatura, playwright, unpdf
--
-- Additive precedent: ID-42. The 11 existing legacy values are PRESERVED
-- verbatim (nothing removed) so every existing row continues to satisfy the
-- constraint. The NULL guard is retained on both tables. Per-table expression
-- shape is preserved: source_documents.extraction_method is a text column
-- (no cast); feed_articles.extraction_method is varchar (cast to text).

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_min_messages = warning;

-- public.source_documents — text column, no cast on the column reference.
ALTER TABLE public.source_documents DROP CONSTRAINT IF EXISTS source_documents_extraction_method_check;
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_extraction_method_check
  CHECK ((("extraction_method" IS NULL) OR ("extraction_method" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'pullmd_readability'::"text", 'pullmd_playwright'::"text", 'pullmd_cloudflare'::"text", 'pullmd_reddit'::"text", 'pullmd_trafilatura'::"text", 'docling'::"text", 'trafilatura'::"text", 'playwright'::"text", 'unpdf'::"text"]))));

COMMENT ON COLUMN public.source_documents.extraction_method IS 'Extractor that produced the markdown; pullmd_* mirrors X-Source, docling for binary (ID-42). In-house extractors (ID-112): trafilatura/playwright for HTML+URL, unpdf for PDF.';

-- public.feed_articles — varchar column, requires the ::"text" cast on the column reference.
ALTER TABLE public.feed_articles DROP CONSTRAINT IF EXISTS feed_articles_extraction_method_check;
ALTER TABLE public.feed_articles ADD CONSTRAINT feed_articles_extraction_method_check
  CHECK ((("extraction_method" IS NULL) OR (("extraction_method")::"text" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'pullmd_readability'::"text", 'pullmd_playwright'::"text", 'pullmd_cloudflare'::"text", 'pullmd_reddit'::"text", 'pullmd_trafilatura'::"text", 'docling'::"text", 'trafilatura'::"text", 'playwright'::"text", 'unpdf'::"text"]))));

COMMENT ON COLUMN public.feed_articles.extraction_method IS 'Extractor that produced the article content; pullmd_* mirrors X-Source, docling for binary (ID-42). In-house extractors (ID-112): trafilatura/playwright for HTML+URL, unpdf for PDF.';
