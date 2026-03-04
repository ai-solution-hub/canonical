-- =============================================================================
-- Automated quality scan function
-- Scans content_items and creates quality flags in ingestion_quality_log
-- for any issues found. Idempotent -- does not create duplicate flags.
--
-- Usage:
--   SELECT * FROM run_quality_scan();
--   SELECT * FROM run_quality_scan('my-import-batch');
-- =============================================================================

CREATE OR REPLACE FUNCTION run_quality_scan(
    p_batch_name TEXT DEFAULT 'quality-scan-' || to_char(NOW(), 'YYYYMMDD-HH24MISS')
)
RETURNS TABLE (
    issue_type TEXT,
    items_found BIGINT,
    flags_created BIGINT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_missing_domain BIGINT := 0;
    v_missing_domain_flagged BIGINT := 0;
    v_low_confidence BIGINT := 0;
    v_low_confidence_flagged BIGINT := 0;
    v_empty_source_url BIGINT := 0;
    v_empty_content BIGINT := 0;
    v_empty_content_flagged BIGINT := 0;
BEGIN
    -- 1. Missing domain classification
    SELECT COUNT(*) INTO v_missing_domain
    FROM content_items
    WHERE primary_domain IS NULL;

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'classification_low',
        'warning',
        jsonb_build_object(
            'confidence', COALESCE(ci.classification_confidence, 0),
            'reason', 'Missing domain classification',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE ci.primary_domain IS NULL
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'classification_low'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_missing_domain_flagged = ROW_COUNT;

    -- 2. Low classification confidence (< 0.30)
    SELECT COUNT(*) INTO v_low_confidence
    FROM content_items
    WHERE primary_domain IS NOT NULL
      AND classification_confidence IS NOT NULL
      AND classification_confidence < 0.30;

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'classification_low',
        'info',
        jsonb_build_object(
            'confidence', ci.classification_confidence,
            'domain', ci.primary_domain,
            'subtopic', ci.primary_subtopic,
            'reason', 'Very low classification confidence (< 0.30)',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE ci.primary_domain IS NOT NULL
      AND ci.classification_confidence IS NOT NULL
      AND ci.classification_confidence < 0.30
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'classification_low'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_low_confidence_flagged = ROW_COUNT;

    -- 3. Empty-string source_url (fix in-place)
    UPDATE content_items
    SET source_url = NULL
    WHERE source_url = '';

    GET DIAGNOSTICS v_empty_source_url = ROW_COUNT;

    UPDATE content_items
    SET source_domain = NULL
    WHERE source_domain = '';

    -- 4. Empty content field
    SELECT COUNT(*) INTO v_empty_content
    FROM content_items
    WHERE content IS NULL OR TRIM(content) = '';

    INSERT INTO ingestion_quality_log (content_item_id, flag_type, severity, details, ingestion_batch)
    SELECT
        ci.id,
        'missing_content',
        'error',
        jsonb_build_object(
            'reason', 'Content field is empty or NULL',
            'scan_source', 'run_quality_scan'
        ),
        p_batch_name
    FROM content_items ci
    WHERE (ci.content IS NULL OR TRIM(ci.content) = '')
      AND ci.id NOT IN (
          SELECT iql.content_item_id
          FROM ingestion_quality_log iql
          WHERE iql.flag_type = 'missing_content'
            AND iql.resolved = FALSE
            AND iql.content_item_id IS NOT NULL
      );

    GET DIAGNOSTICS v_empty_content_flagged = ROW_COUNT;

    -- Return summary
    RETURN QUERY VALUES
        ('missing_domain_classification', v_missing_domain, v_missing_domain_flagged),
        ('low_confidence_classification', v_low_confidence, v_low_confidence_flagged),
        ('empty_string_source_url_fixed', v_empty_source_url, 0::BIGINT),
        ('empty_content', v_empty_content, v_empty_content_flagged);
END;
$$;

GRANT EXECUTE ON FUNCTION run_quality_scan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION run_quality_scan(TEXT) TO service_role;

-- =============================================================================
-- Quality issue counts for dashboard/UI
-- Returns aggregate counts of open quality flags by type and severity
-- =============================================================================

CREATE OR REPLACE FUNCTION get_quality_issue_counts()
RETURNS TABLE (
    flag_type TEXT,
    severity TEXT,
    open_count BIGINT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT
        iql.flag_type,
        iql.severity,
        COUNT(*) AS open_count
    FROM ingestion_quality_log iql
    WHERE iql.resolved = FALSE
    GROUP BY iql.flag_type, iql.severity
    ORDER BY
        CASE iql.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END,
        iql.flag_type;
$$;

GRANT EXECUTE ON FUNCTION get_quality_issue_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION get_quality_issue_counts() TO service_role;

-- =============================================================================
-- Get content_item IDs that have open quality flags
-- Used by the browse page "has quality issues" filter
-- =============================================================================

CREATE OR REPLACE FUNCTION get_items_with_quality_flags()
RETURNS SETOF UUID LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT DISTINCT content_item_id
    FROM ingestion_quality_log
    WHERE resolved = FALSE
      AND content_item_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION get_items_with_quality_flags() TO authenticated;
GRANT EXECUTE ON FUNCTION get_items_with_quality_flags() TO service_role;
