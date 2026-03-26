-- Coverage Targets: Per-domain configurable coverage goals
-- Extensible (domain_id, metric_name, target_value) model
-- Spec: docs/plans/bid-session-coverage-spec.md section B2

CREATE TABLE IF NOT EXISTS coverage_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL REFERENCES taxonomy_domains(id) ON DELETE CASCADE,
  metric_name text NOT NULL,
  target_value numeric NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  CONSTRAINT coverage_targets_metric_check
    CHECK (metric_name IN ('item_count', 'fresh_pct', 'max_expired')),
  CONSTRAINT coverage_targets_domain_metric_unique
    UNIQUE (domain_id, metric_name)
);

ALTER TABLE coverage_targets ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read targets
CREATE POLICY "coverage_targets_select" ON coverage_targets
  FOR SELECT TO authenticated USING (true);

-- Only admins can insert
CREATE POLICY "coverage_targets_admin_insert" ON coverage_targets
  FOR INSERT TO authenticated
  WITH CHECK ((select public.get_user_role()) IN ('admin'));

-- Only admins can update
CREATE POLICY "coverage_targets_admin_update" ON coverage_targets
  FOR UPDATE TO authenticated
  USING ((select public.get_user_role()) IN ('admin'))
  WITH CHECK ((select public.get_user_role()) IN ('admin'));

-- Only admins can delete
CREATE POLICY "coverage_targets_admin_delete" ON coverage_targets
  FOR DELETE TO authenticated
  USING ((select public.get_user_role()) IN ('admin'));

COMMENT ON TABLE coverage_targets IS 'Per-domain coverage targets. Extensible metric model — add new metric_name values via CHECK constraint update.';
COMMENT ON COLUMN coverage_targets.metric_name IS 'Target metric: item_count (minimum items), fresh_pct (minimum freshness 0-100), max_expired (maximum expired items)';
COMMENT ON COLUMN coverage_targets.target_value IS 'Numeric target value. Interpretation depends on metric_name.';
