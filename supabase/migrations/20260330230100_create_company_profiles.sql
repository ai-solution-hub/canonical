-- ============================================================
-- company_profiles: anchors intelligence config to client context
-- ============================================================

CREATE TABLE company_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name              text NOT NULL,
  slug              varchar NOT NULL UNIQUE,
  description       text,
  website_url       text,

  -- Business context (arrays for multi-value, GIN-indexed)
  sectors           text[] NOT NULL DEFAULT '{}',
  services          text[] NOT NULL DEFAULT '{}',
  certifications    text[] NOT NULL DEFAULT '{}',
  geographic_scope  text[] NOT NULL DEFAULT '{}',

  -- Competitive landscape (JSONB exception: lightweight, managed as unit)
  competitors       jsonb NOT NULL DEFAULT '[]',

  -- Classification context for scoring prompts
  target_customers  text,
  value_proposition text,
  key_topics        text[] NOT NULL DEFAULT '{}',

  -- Metadata
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id)
);

-- Indexes (slug has implicit unique index from UNIQUE constraint)
CREATE INDEX idx_company_profiles_sectors ON company_profiles USING GIN(sectors);

-- RLS
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and editor can read company_profiles"
  ON company_profiles FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin and editor can insert company_profiles"
  ON company_profiles FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin and editor can update company_profiles"
  ON company_profiles FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'editor'))
  WITH CHECK (public.get_user_role() IN ('admin', 'editor'));

CREATE POLICY "Admin can delete company_profiles"
  ON company_profiles FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- Trigger for updated_at
CREATE TRIGGER set_company_profiles_updated_at
  BEFORE UPDATE ON company_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
