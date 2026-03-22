-- Add stored quality_score columns to content_items and quality_score_threshold
-- to governance_config for per-domain quality governance.
--
-- Phase 1 of the Quality Manager Enhancement spec.

-- ============================================================
-- 1. Add quality_score column (integer, 0–100) to content_items
-- ============================================================
-- Use IF NOT EXISTS for safety — a legacy REAL column may exist
-- in some environments from the base schema migration.
DO $$
BEGIN
  -- Drop legacy REAL column if it exists (replace with INTEGER)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'content_items'
      AND column_name = 'quality_score'
      AND data_type = 'real'
  ) THEN
    ALTER TABLE content_items DROP COLUMN quality_score;
  END IF;
END $$;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS quality_score INTEGER;

-- Add CHECK constraint for valid range 0–100
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'content_items'
      AND constraint_name = 'content_items_quality_score_range'
  ) THEN
    ALTER TABLE content_items
      ADD CONSTRAINT content_items_quality_score_range
      CHECK (quality_score >= 0 AND quality_score <= 100);
  END IF;
END $$;

-- ============================================================
-- 2. Add quality_score_updated_at column
-- ============================================================
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS quality_score_updated_at TIMESTAMPTZ;

-- ============================================================
-- 3. Add previous_quality_score column (nullable)
-- ============================================================
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS previous_quality_score INTEGER;

-- ============================================================
-- 4. Add index on quality_score for non-archived items
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_content_items_quality_score
  ON content_items (quality_score)
  WHERE archived_at IS NULL;

-- ============================================================
-- 5. Add quality_score_threshold column to governance_config
-- ============================================================
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS quality_score_threshold INTEGER DEFAULT 40;

-- ============================================================
-- 6. Backfill function — approximates lib/quality-score.ts formula
-- ============================================================
-- Components and weights:
--   Freshness (30%): fresh=100, ageing/aging=60, stale=30, expired=0, null=100
--   Classification confidence (20%): 0–1 scaled to 0–100
--   Depth completeness (20%): count(brief, detail, reference) / 3 * 100
--   Summary quality (15%): ai_summary present = 100, else 0
--   Citation history (15%): min(citation_count * 20, 100)

CREATE OR REPLACE FUNCTION backfill_quality_scores()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  v_freshness_raw INTEGER;
  v_confidence_raw NUMERIC;
  v_completeness_raw NUMERIC;
  v_summary_raw INTEGER;
  v_citations_raw INTEGER;
  v_citation_count INTEGER;
  v_layer_count INTEGER;
  v_score INTEGER;
BEGIN
  FOR rec IN
    SELECT
      id,
      freshness,
      classification_confidence,
      brief,
      detail,
      reference,
      ai_summary,
      metadata
    FROM content_items
    WHERE archived_at IS NULL
  LOOP
    -- Freshness component (30%)
    v_freshness_raw := CASE
      WHEN rec.freshness IS NULL THEN 100
      WHEN rec.freshness = 'fresh' THEN 100
      WHEN rec.freshness IN ('ageing', 'aging') THEN 60
      WHEN rec.freshness = 'stale' THEN 30
      WHEN rec.freshness = 'expired' THEN 0
      ELSE 100
    END;

    -- Classification confidence component (20%)
    v_confidence_raw := COALESCE(
      LEAST(GREATEST(rec.classification_confidence, 0), 1) * 100,
      0
    );

    -- Depth completeness component (20%)
    v_layer_count := 0;
    IF rec.brief IS NOT NULL AND TRIM(rec.brief) != '' THEN
      v_layer_count := v_layer_count + 1;
    END IF;
    IF rec.detail IS NOT NULL AND TRIM(rec.detail) != '' THEN
      v_layer_count := v_layer_count + 1;
    END IF;
    IF rec.reference IS NOT NULL AND TRIM(rec.reference) != '' THEN
      v_layer_count := v_layer_count + 1;
    END IF;
    v_completeness_raw := (v_layer_count::NUMERIC / 3.0) * 100;

    -- Summary quality component (15%)
    v_summary_raw := CASE
      WHEN rec.ai_summary IS NOT NULL AND TRIM(rec.ai_summary) != '' THEN 100
      ELSE 0
    END;

    -- Citation history component (15%)
    v_citation_count := COALESCE(
      (rec.metadata->>'citation_count')::INTEGER,
      0
    );
    v_citations_raw := LEAST(v_citation_count * 20, 100);

    -- Calculate weighted score (matching TypeScript rounding)
    v_score := ROUND(
      ROUND(v_freshness_raw * 0.3 * 100) / 100.0 +
      ROUND(v_confidence_raw * 0.2 * 100) / 100.0 +
      ROUND(v_completeness_raw * 0.2 * 100) / 100.0 +
      ROUND(v_summary_raw * 0.15 * 100) / 100.0 +
      ROUND(v_citations_raw * 0.15 * 100) / 100.0
    );

    -- Store the score
    UPDATE content_items
    SET
      quality_score = v_score,
      quality_score_updated_at = NOW()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

-- Run the backfill
SELECT backfill_quality_scores();

-- Drop the backfill function after use
DROP FUNCTION IF EXISTS backfill_quality_scores();
