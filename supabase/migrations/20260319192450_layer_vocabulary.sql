-- ============================================================================
-- layer_vocabulary: DB-driven content layer definitions
-- ============================================================================

CREATE TABLE layer_vocabulary (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           varchar(50) NOT NULL UNIQUE,
  label         varchar(100) NOT NULL,
  description   text,
  display_order int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);

-- Index for ordered active layers (the common query)
CREATE INDEX idx_layer_vocabulary_active_order
  ON layer_vocabulary (display_order ASC)
  WHERE is_active = true;

-- Seed the four existing layers
INSERT INTO layer_vocabulary (key, label, description, display_order) VALUES
  ('sales_brief',       'Sales Brief',       'Positioning and messaging for internal sales', 10),
  ('bid_detail',        'Bid Detail',        'Factual content for tender responses',         20),
  ('company_reference', 'Company Reference', 'Controlled corporate documents',               30),
  ('research',          'Research',          'Background material and market intelligence',   40);

-- ============================================================================
-- RLS policies
-- ============================================================================

ALTER TABLE layer_vocabulary ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active layers
CREATE POLICY "All authenticated: SELECT layer_vocabulary"
  ON layer_vocabulary
  FOR SELECT
  TO authenticated
  USING (true);

-- Admin only: full write access
CREATE POLICY "Admin: INSERT layer_vocabulary"
  ON layer_vocabulary
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT get_user_role()) = 'admin'
  );

CREATE POLICY "Admin: UPDATE layer_vocabulary"
  ON layer_vocabulary
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin'
  )
  WITH CHECK (
    (SELECT get_user_role()) = 'admin'
  );

CREATE POLICY "Admin: DELETE layer_vocabulary"
  ON layer_vocabulary
  FOR DELETE
  TO authenticated
  USING (
    (SELECT get_user_role()) = 'admin'
  );
