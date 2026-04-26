-- Tag morphology drift flags table — §1.17 / S197 WP3
-- Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4
--
-- Stores per-(stored_tag, proposed_canonical) disagreements surfaced by the
-- corpus regression eval (scripts/eval-tag-morphology-adoption.ts). Each row
-- is a triage candidate: admin/editor reviews and dispositions to one of
--   pending → accept | add_override | dismiss
-- Backfills then run from accepted flags (no auto-backfill — Liam decision
-- recorded in spec §3.5.3).

CREATE TABLE tag_morphology_drift_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stored_tag text NOT NULL,                 -- existing tag in ai_keywords
  proposed_canonical text NOT NULL,         -- library output for stored_tag
  usage_count integer NOT NULL,             -- frequency in corpus at snapshot time
  affected_content_ids uuid[] NOT NULL,     -- content_items carrying this tag
  detected_at timestamptz NOT NULL DEFAULT now(),
  decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'accept', 'add_override', 'dismiss')),
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_rationale text,
  UNIQUE (stored_tag, proposed_canonical)
);

-- Pending-decision lookup index (partial — only un-triaged rows)
CREATE INDEX idx_tag_morphology_drift_flags_decision
  ON tag_morphology_drift_flags (decision)
  WHERE decision = 'pending';

-- Detected-at index for ordered listing
CREATE INDEX idx_tag_morphology_drift_flags_detected_at
  ON tag_morphology_drift_flags (detected_at DESC);

-- RLS — admin + editor only (taxonomy is a governance decision)
ALTER TABLE tag_morphology_drift_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_editor_read_tag_morphology_drift_flags"
  ON tag_morphology_drift_flags
  FOR SELECT
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "admin_editor_insert_tag_morphology_drift_flags"
  ON tag_morphology_drift_flags
  FOR INSERT
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "admin_editor_update_tag_morphology_drift_flags"
  ON tag_morphology_drift_flags
  FOR UPDATE
  USING (public.get_user_role() IN ('admin', 'editor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "admin_editor_delete_tag_morphology_drift_flags"
  ON tag_morphology_drift_flags
  FOR DELETE
  USING (public.get_user_role() IN ('admin', 'editor'));

COMMENT ON TABLE tag_morphology_drift_flags IS
  'Triage queue for tag morphology drift surfaced by the eval-tag-morphology-adoption script. '
  'Each row is one (stored_tag, proposed_canonical) disagreement awaiting human disposition. '
  'See docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.4.';
