-- WP-A4 Task 3.3: backfill content_items.ingest_source from legacy
-- metadata.ingestion_source / metadata.source / platform inferences.
--
-- Spec: docs/specs/ingest-path-consistency-spec.md §8.3 (Wave 3 fix H-2 —
-- full Python ingestion_source audit) + plan §Phase 3 Task 3.3.
--
-- Idempotent (AC3.3-AC3): WHERE ingest_source IS NULL guarantees re-runs
-- are no-ops once values are populated. Best-effort (AC3.3-AC2): rows
-- with no inferable signal remain NULL — the trigger's CASE fallback
-- still emits change_reason='auto_v1_on_insert' for those v1 history
-- rows (legacy semantics preserved).
--
-- Pre-flight queries (run on target before applying):
--   -- Q5: distinct legacy values + counts
--   SELECT DISTINCT metadata->>'ingestion_source' AS legacy_source,
--          COUNT(*) AS row_count
--   FROM content_items GROUP BY 1 ORDER BY 2 DESC;
--
--   -- Q6: rows lacking any inferable signal
--   SELECT COUNT(*) FROM content_items
--   WHERE ingest_source IS NULL
--     AND metadata->>'ingestion_source' IS NULL;
--
-- Staging pre-flight (28/04/2026): persistent branch turayklvaunphgbgscat
-- is data-empty (total_rows=0). The backfill is a no-op on staging by
-- definition; correctness is validated via the SQL plan and is exercised
-- against real rows when this migration is replayed against prod (deferred
-- to a later wave per spec scoping).
--
-- Rollback: setting content_items.ingest_source = NULL is safe (column
-- was added by 20260428174512 and the v1 trigger tolerates NULL via the
-- legacy 'auto_v1_on_insert' fallback). Or drop the column entirely per
-- the rollback path embedded in the parent migration's function COMMENT.

UPDATE public.content_items
SET ingest_source = CASE
  -- TS web-app paths (canonical Appendix D values)
  WHEN metadata->>'ingestion_source' = 'upload' THEN 'upload'
  WHEN metadata->>'ingestion_source' = 'url_import' THEN 'url_import'
  WHEN metadata->>'ingestion_source' = 'manual' THEN 'manual'
  WHEN metadata->>'ingestion_source' = 'upload_autosplit' THEN 'upload_autosplit'
  WHEN metadata->>'ingestion_source' = 'mcp_create' THEN 'mcp_create'
  WHEN metadata->>'ingestion_source' = 'rss_feed' THEN 'rss_feed'
  WHEN metadata->>'ingestion_source' = 'bid_outcome_integration' THEN 'bid_outcome_integration'
  WHEN metadata->>'ingestion_source' = 'batch_reclassify' THEN 'batch_reclassify'
  -- Python paths (Wave 3 fix H-2 — 5 audited values)
  WHEN metadata->>'ingestion_source' = 'markdown_file' THEN 'python_markdown'
  WHEN metadata->>'ingestion_source' = 'markdown_import' THEN 'python_markdown'
  WHEN metadata->>'ingestion_source' = 'stage2_markdown' THEN 'python_markdown'
  WHEN metadata->>'ingestion_source' = 'bid_library' THEN 'qa_import'
  WHEN metadata->>'ingestion_source' = 'bid_library_import' THEN 'qa_import'
  -- Pipeline / service-account inference
  WHEN metadata->>'source' = 'intelligence_pipeline' THEN 'rss_feed'
  -- Last-ditch heuristics for rows missing metadata.ingestion_source
  WHEN platform = 'extraction' THEN 'qa_import'
  WHEN platform = 'web' THEN 'url_import'
  ELSE NULL
END
WHERE ingest_source IS NULL;

-- Post-flight verification queries (run after applying):
--   SELECT ingest_source, COUNT(*) FROM content_items GROUP BY 1 ORDER BY 2 DESC;
--   SELECT COUNT(*) FROM content_items WHERE ingest_source IS NULL;
--
-- AC3.3-AC1: ≥3 distinct ingest_source values surface post-backfill (validated against prod).
-- AC3.3-AC2: residual NULLs <5% of total acceptable; >5% triggers row-by-row inspection.
-- AC3.3-AC3: re-running this migration is a no-op (WHERE ingest_source IS NULL filter).
