-- ID-130.23 B1 — extend source_documents.extraction_method CHECK to admit
-- 'mcp_create' (LIVE prod bug: every source_url create_content_item fails).
--
-- lib/mcp/tools/content.ts's create_content_item source_url branch
-- (~line 669) sets extraction_metadata.extractor = 'mcp_create' and passes it
-- to the reference_ingest RPC (20260619130100_id112_reference_ingest_derive_
-- method.sql), which derives source_documents.extraction_method server-side
-- from p_extraction_metadata->>'extractor'. The CHECK constraint rebuilt at
-- 20260624155556_id129_pullmd_decommission.sql only admits the 9 scraper/
-- extractor labels (rss_content/fetch/jina_reader/firecrawl/summary_fallback/
-- docling/trafilatura/playwright/unpdf) — none of which is honest for an
-- MCP-tool-created (non-scraped) reference — so the CHECK rejects every
-- source_url create_content_item call.
--
-- Owner ruling (oq-d48c3a9fcb376471): extend the allowlist with 'mcp_create'
-- rather than reusing an existing label — it IS a distinct provenance class
-- from every scraper value (no scrape occurred; the caller supplied the body
-- directly via the MCP tool), so a dedicated label is the honest one.
--
-- Forward-only. NEVER edit the squash baseline (S408 fidelity lesson).

ALTER TABLE public.source_documents DROP CONSTRAINT IF EXISTS source_documents_extraction_method_check;
ALTER TABLE public.source_documents ADD CONSTRAINT source_documents_extraction_method_check
  CHECK ((("extraction_method" IS NULL) OR ("extraction_method" = ANY (ARRAY['rss_content'::"text", 'fetch'::"text", 'jina_reader'::"text", 'firecrawl'::"text", 'summary_fallback'::"text", 'docling'::"text", 'trafilatura'::"text", 'playwright'::"text", 'unpdf'::"text", 'mcp_create'::"text"]))));

COMMENT ON COLUMN public.source_documents.extraction_method IS 'Extractor that produced the markdown; docling for binary (ID-42). In-house extractors (ID-112): trafilatura/playwright for HTML+URL, unpdf for PDF. mcp_create (ID-130.23): MCP create_content_item source_url branch — caller-supplied body, no scrape.';
