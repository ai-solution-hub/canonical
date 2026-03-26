-- Verification history: full audit trail of verify/unverify/flag actions
-- Immutable table (INSERT only, no UPDATE/DELETE) — same pattern as content_history

CREATE TABLE verification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  action_type varchar(20) NOT NULL CHECK (action_type IN ('verify', 'unverify', 'flag')),
  note text DEFAULT NULL,
  performed_by uuid NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE verification_history IS
  'Audit trail of verification actions on content items. Each verify, unverify, or flag action creates a row.';

COMMENT ON COLUMN verification_history.content_item_id IS
  'The content item this verification action relates to';

COMMENT ON COLUMN verification_history.action_type IS
  'Action taken: verify (mark as verified), unverify (remove verification), flag (raise quality concern)';

COMMENT ON COLUMN verification_history.note IS
  'Optional reviewer note, max 500 characters enforced at application layer';

COMMENT ON COLUMN verification_history.performed_by IS
  'UUID of the user who performed the action';

COMMENT ON COLUMN verification_history.performed_at IS
  'Timestamp when the action was performed';

-- Index for common query: "get history for this item"
CREATE INDEX idx_verification_history_item
  ON verification_history(content_item_id, performed_at DESC);

-- Index for "what did this user verify recently?"
CREATE INDEX idx_verification_history_user
  ON verification_history(performed_by, performed_at DESC);

-- RLS: all authenticated can read, editors/admins can insert
ALTER TABLE verification_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "verification_history_select"
  ON verification_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "verification_history_insert"
  ON verification_history FOR INSERT
  TO authenticated
  WITH CHECK (get_user_role()::text IN ('admin', 'editor'));

-- Immutable: no UPDATE or DELETE policies (same pattern as content_history)
