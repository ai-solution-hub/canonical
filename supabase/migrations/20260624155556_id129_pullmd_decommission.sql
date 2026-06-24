-- ID-129.3 — PullMD full decommission: schema surface drop.
--
-- pullmd is removed from canonical entirely (AGPL-3.0 incompatible; superseded by the
-- in-house trafilatura/docling extractors shipped in ID-112). Subtasks 129.1/129.2/129.4
-- already removed the compose services, the dead Python (incl. the two declare_row
-- pullmd_share_id WRITES — column is now WRITE-DEAD), and the UI label. This migration
-- removes the remaining DB surface.
--
-- Verified live (staging branch rbwqewalexrzgxtvcqrh, schema-parity with prod
-- zjqbrdctesqvouboziae): extraction_method is a CHECK-constrained column (NOT a PG enum)
-- on BOTH source_documents (text, no cast) and feed_articles (varchar, ::"text" cast);
-- pullmd_share_id is on source_documents ONLY. Zero live rows depend
-- (sd_nonnull_share_ids=0, pullmd_method_rows=0 on both tables) — column drop is safe,
-- no data migration. Expression shape mirrors 20260619130000_id112.
--
-- Forward-only. NEVER edit the squash baseline (S408 fidelity lesson).

-- 1. source_documents.extraction_method CHECK — rebuild minus the 5 pullmd_* values
--    (text column, no cast — mirrors id112 source_documents shape).
ALTER TABLE public.source_documents DROP CONSTRAINT IF EXISTS source_documents_extraction_method_check;
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_extraction_method_check
  CHECK ((("extraction_method" IS NULL) OR ("extraction_method" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'docling'::"text", 'trafilatura'::"text", 'playwright'::"text", 'unpdf'::"text"]))));

COMMENT ON COLUMN public.source_documents.extraction_method IS 'Extractor that produced the markdown; docling for binary (ID-42). In-house extractors (ID-112): trafilatura/playwright for HTML+URL, unpdf for PDF.';

-- 2. feed_articles.extraction_method CHECK — rebuild minus the 5 pullmd_* values
--    (varchar column, ::"text" cast — mirrors id112 feed_articles shape).
ALTER TABLE public.feed_articles DROP CONSTRAINT IF EXISTS feed_articles_extraction_method_check;
ALTER TABLE public.feed_articles ADD CONSTRAINT feed_articles_extraction_method_check
  CHECK ((("extraction_method" IS NULL) OR (("extraction_method")::"text" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'docling'::"text", 'trafilatura'::"text", 'playwright'::"text", 'unpdf'::"text"]))));

COMMENT ON COLUMN public.feed_articles.extraction_method IS 'Extractor that produced the article content; docling for binary (ID-42). In-house extractors (ID-112): trafilatura/playwright for HTML+URL, unpdf for PDF.';

-- 3. Drop the partial index on the soon-to-be-dropped column.
DROP INDEX IF EXISTS public.idx_source_documents_pullmd_share_id;

-- 4. Recreate the api.source_documents view without pullmd_share_id. Column list is
--    identical to 20260623140000_id115 MINUS pullmd_share_id; grants re-applied verbatim.
DROP VIEW IF EXISTS api.source_documents;
CREATE VIEW api.source_documents WITH (security_invoker = true) AS
  SELECT
    id,
    filename,
    original_filename,
    mime_type,
    file_size,
    content_hash,
    version,
    parent_id,
    storage_path,
    status,
    extracted_text,
    extraction_metadata,
    workspace_id,
    pipeline_run_id,
    uploaded_by,
    created_at,
    archived_at,
    archived_by,
    op_id,
    extraction_method,
    source_url
  FROM public.source_documents;
GRANT SELECT ON api.source_documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.source_documents TO service_role;

-- 5. Drop the now-unreferenced column.
ALTER TABLE public.source_documents DROP COLUMN IF EXISTS pullmd_share_id;
