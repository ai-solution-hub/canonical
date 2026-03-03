-- Add 'dead_letter' to the flag_type CHECK constraint on ingestion_quality_log.
-- The bookmarklet queue processor already writes this value but it was missing
-- from the constraint.

ALTER TABLE ingestion_quality_log
  DROP CONSTRAINT quality_log_valid_flag_type;

ALTER TABLE ingestion_quality_log
  ADD CONSTRAINT quality_log_valid_flag_type CHECK (
    flag_type IN (
      'missing_thumbnail', 'short_content', 'missing_date',
      'duplicate_candidate', 'scrape_failed', 'encoding_issue',
      'missing_author', 'classification_low', 'manual_review',
      'dead_letter'
    )
  );
