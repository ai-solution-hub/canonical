-- Quality-to-Governance Bridge Migration
-- Adds columns for auto-flagging items when quality drops or freshness transitions,
-- plus a cooldown column on content_items to prevent re-flagging noise.

-- governance_config: toggle for auto-flagging on quality drop
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_on_quality_drop BOOLEAN DEFAULT false;

-- governance_config: toggle for auto-flagging on freshness transition (Phase 2 uses this)
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_on_freshness_transition BOOLEAN DEFAULT false;

-- governance_config: cooldown days to prevent re-flagging recently flagged items
ALTER TABLE governance_config
  ADD COLUMN IF NOT EXISTS auto_flag_cooldown_days INTEGER DEFAULT 7;

-- content_items: tracks when an item was last auto-flagged for cooldown checks
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS last_auto_flagged_at TIMESTAMPTZ;
