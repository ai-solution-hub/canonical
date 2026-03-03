-- Backfill ai_summary with summary_data.executive for all items that have
-- summary_data. The executive summary is generated from full content and is
-- higher quality than the classification-time ai_summary.
--
-- This is a one-off data update. Going forward, the API route and batch script
-- will keep ai_summary in sync with summary_data.executive at generation time.

UPDATE content_items
SET ai_summary = summary_data->>'executive'
WHERE summary_data IS NOT NULL
  AND summary_data->>'executive' IS NOT NULL
  AND summary_data->>'executive' != ''
  AND (
    ai_summary IS NULL
    OR ai_summary != summary_data->>'executive'
  );
