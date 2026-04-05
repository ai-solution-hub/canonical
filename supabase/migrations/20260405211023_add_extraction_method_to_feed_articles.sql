-- Add extraction_method column to feed_articles
-- Tracks which extraction tier was used: rss_content, fetch, jina_reader, firecrawl, summary_fallback
ALTER TABLE feed_articles
  ADD COLUMN extraction_method varchar
  CHECK (extraction_method IN ('rss_content', 'fetch', 'jina_reader', 'firecrawl', 'summary_fallback'));
