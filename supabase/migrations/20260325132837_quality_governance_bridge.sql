-- Quality-to-Governance Bridge Migration
-- Adds columns for auto-flagging items when quality drops or freshness transitions.
-- Cooldown uses existing content_items.verified_at (no new column needed).

-- governance_config: toggle for auto-flagging on quality drop
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_on_quality_drop BOOLEAN DEFAULT true;

-- governance_config: toggle for auto-flagging on freshness transition (Phase 2 uses this)
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_on_freshness_transition BOOLEAN DEFAULT true;

-- governance_config: cooldown days to prevent re-flagging recently flagged items
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_cooldown_days INTEGER DEFAULT 7;
