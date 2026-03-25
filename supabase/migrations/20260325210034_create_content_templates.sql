-- Content creation templates
CREATE TABLE content_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(50) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  description text NOT NULL DEFAULT '',
  content_type varchar(50) NOT NULL,
  title_template text NOT NULL DEFAULT '',
  content_template text NOT NULL DEFAULT '',
  brief_template text DEFAULT NULL,
  suggested_domain varchar(100) DEFAULT NULL,
  default_tags text[] DEFAULT '{}',
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT NULL
);

COMMENT ON TABLE content_templates IS
  'Content creation templates that pre-fill the create form with suggested structure and metadata.';

-- RLS: all authenticated can read, admin only can manage
ALTER TABLE content_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_templates_select"
  ON content_templates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "content_templates_admin_manage"
  ON content_templates FOR ALL
  TO authenticated
  USING (
    get_user_role()::text = 'admin'
  );
