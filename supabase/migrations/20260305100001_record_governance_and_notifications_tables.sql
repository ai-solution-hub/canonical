-- C4: Record governance_config and notifications table DDL
-- These tables were created via direct MCP execution in earlier sessions.
-- This migration documents the intended schema for reproducibility.
-- All statements use IF NOT EXISTS / DO $$ guards so they are safe to replay.

-- ============================================================
-- governance_config
-- ============================================================
CREATE TABLE IF NOT EXISTS governance_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  posture text NOT NULL DEFAULT 'open'::text,
  reviewer_id uuid,
  timeout_days integer DEFAULT 7,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT governance_config_pkey PRIMARY KEY (id),
  CONSTRAINT governance_config_domain_key UNIQUE (domain),
  CONSTRAINT governance_config_posture_check CHECK (posture = ANY (ARRAY['open'::text, 'review_on_change'::text])),
  CONSTRAINT governance_config_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id),
  CONSTRAINT governance_config_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT governance_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_governance_config_reviewer_id ON governance_config (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_governance_config_created_by ON governance_config (created_by);
CREATE INDEX IF NOT EXISTS idx_governance_config_updated_by ON governance_config (updated_by);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'governance_config'
      AND trigger_name = 'set_governance_config_updated_at'
  ) THEN
    CREATE TRIGGER set_governance_config_updated_at
      BEFORE UPDATE ON governance_config
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- RLS
ALTER TABLE governance_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'governance_config' AND policyname = 'governance_config_select') THEN
    CREATE POLICY governance_config_select ON governance_config FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'governance_config' AND policyname = 'governance_config_insert') THEN
    CREATE POLICY governance_config_insert ON governance_config FOR INSERT TO authenticated WITH CHECK (get_user_role()::text = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'governance_config' AND policyname = 'governance_config_update') THEN
    CREATE POLICY governance_config_update ON governance_config FOR UPDATE TO authenticated USING (get_user_role()::text = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'governance_config' AND policyname = 'governance_config_delete') THEN
    CREATE POLICY governance_config_delete ON governance_config FOR DELETE TO authenticated USING (get_user_role()::text = 'admin');
  END IF;
END $$;

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  title text NOT NULL,
  message text,
  read_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '24 hours'),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notifications_entity_type_check CHECK (entity_type = ANY (ARRAY['content_item'::text, 'digest'::text])),
  -- NOTE: type CHECK is defined/updated in 20260305100000_fix_governance_and_notification_checks.sql
  CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
      'governance_review_needed'::text,
      'governance_approve'::text,
      'governance_request_changes'::text,
      'governance_revert'::text,
      'quality_flag'::text,
      'digest_ready'::text
    ])
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON notifications (entity_type, entity_id);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_select') THEN
    CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_insert') THEN
    CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_update') THEN
    CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'notifications_delete') THEN
    CREATE POLICY notifications_delete ON notifications FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;
