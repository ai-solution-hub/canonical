-- P0-16: Add preset column to governance_config
-- Maps each domain's config to a named preset (light_touch / strict).
-- Existing column values remain intact; six server-side consumers read
-- columns directly and are unaffected.

ALTER TABLE governance_config
ADD COLUMN preset text
CHECK (preset IN ('light_touch', 'strict'));

-- Backfill: assign preset based on existing posture value.
-- Option A (per spec Q1): overwrite column values to match preset defaults.
UPDATE governance_config
SET preset = CASE
  WHEN posture = 'review_on_change' THEN 'strict'
  ELSE 'light_touch'
END
WHERE preset IS NULL;

-- Overwrite column values to match preset defaults (Option A).
-- Light-touch rows:
UPDATE governance_config
SET
  quality_score_threshold = 40,
  auto_flag_on_quality_drop = false,
  auto_flag_on_freshness_transition = false,
  auto_flag_cooldown_days = NULL,
  timeout_days = NULL
WHERE preset = 'light_touch';

-- Strict rows:
UPDATE governance_config
SET
  quality_score_threshold = 60,
  auto_flag_on_quality_drop = true,
  auto_flag_on_freshness_transition = true,
  auto_flag_cooldown_days = 14,
  timeout_days = 7
WHERE preset = 'strict';
