-- OPS-23: Add auto-generate change reports preference toggle.
-- When false, suppresses the auto-fire of weekly digest generation on
-- first /digest page visit. Users retain the manual Generate button.

ALTER TABLE user_notification_prefs
  ADD COLUMN auto_generate_change_reports BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN user_notification_prefs.auto_generate_change_reports IS
  'When false, suppresses the auto-fire of weekly digest generation on first /digest page visit. User still has manual Generate button. See OPS-23.';
