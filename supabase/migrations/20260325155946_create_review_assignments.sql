-- Review Assignments table
-- Supports admin-created review batches assigned to specific team members.
-- Uses explicit filter columns (not JSONB) for queryability and type safety.

CREATE TABLE review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  assigned_by uuid NOT NULL REFERENCES auth.users(id),
  assignment_type text NOT NULL DEFAULT 'manual',
  -- Explicit filter columns
  filter_domains text[] DEFAULT '{}',
  filter_content_types text[] DEFAULT '{}',
  filter_freshness text[] DEFAULT '{}',
  filter_date_from timestamptz,
  filter_date_to timestamptz,
  item_count integer,
  status text NOT NULL DEFAULT 'active',
  notes text,
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT review_assignments_type_check
    CHECK (assignment_type IN ('manual', 'round_robin', 'self_assigned')),
  CONSTRAINT review_assignments_status_check
    CHECK (status IN ('active', 'completed', 'cancelled'))
);

-- Partial index for active assignments per reviewer
CREATE INDEX idx_review_assignments_reviewer
  ON review_assignments (reviewer_id) WHERE status = 'active';

-- Index for admin queries across all assignments
CREATE INDEX idx_review_assignments_status
  ON review_assignments (status, created_at DESC);

-- RLS policies
ALTER TABLE review_assignments ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users can see assignments
CREATE POLICY review_assignments_select
  ON review_assignments FOR SELECT TO authenticated
  USING (true);

-- INSERT: editors and admins can create assignments
CREATE POLICY review_assignments_insert
  ON review_assignments FOR INSERT TO authenticated
  WITH CHECK (get_user_role()::text IN ('admin', 'editor'));

-- UPDATE: editors and admins can update assignments
CREATE POLICY review_assignments_update
  ON review_assignments FOR UPDATE TO authenticated
  USING (get_user_role()::text IN ('admin', 'editor'));

-- DELETE: admins only
CREATE POLICY review_assignments_delete
  ON review_assignments FOR DELETE TO authenticated
  USING (get_user_role()::text = 'admin');

-- updated_at trigger
CREATE TRIGGER set_review_assignments_updated_at
  BEFORE UPDATE ON review_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
