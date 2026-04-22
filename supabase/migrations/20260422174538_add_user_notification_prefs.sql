-- P1-18: User notification preferences table
-- Stores per-user email notification toggles (3 booleans, all default ON).
-- Designed for future cron/digest jobs to query directly.

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email_weekly_change_report boolean NOT NULL DEFAULT true,
  email_review_assigned boolean NOT NULL DEFAULT true,
  email_owned_content_flagged boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_notification_prefs IS
  'Per-user email notification preferences. Rows created on first toggle; defaults = all ON.';

-- Auto-update updated_at on modification
CREATE OR REPLACE FUNCTION update_user_notification_prefs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_notification_prefs_updated_at
  BEFORE UPDATE ON user_notification_prefs
  FOR EACH ROW
  EXECUTE FUNCTION update_user_notification_prefs_updated_at();

-- RLS: users can only read/write their own row
ALTER TABLE user_notification_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notification prefs"
  ON user_notification_prefs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own notification prefs"
  ON user_notification_prefs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notification prefs"
  ON user_notification_prefs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
