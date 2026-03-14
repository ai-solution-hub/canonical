-- Guide definitions — curated, ordered reading experiences over existing KB content
CREATE TABLE guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  guide_type text NOT NULL DEFAULT 'sector',
  domain_filter text,  -- maps to taxonomy_domains.name, NULL = cross-domain
  icon text,
  color text,
  display_order int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guides_type_check CHECK (guide_type IN ('sector', 'product', 'company', 'research', 'custom'))
);

-- Guide sections — ordered subsections within a guide
CREATE TABLE guide_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  section_name text NOT NULL,
  description text,
  expected_layer text,  -- which content layer this section expects (sales_brief, bid_detail, etc.)
  subtopic_filter text, -- maps to taxonomy_subtopics.name
  content_type_filter text, -- optional: only show specific content types
  display_order int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guide_sections_layer_check CHECK (
    expected_layer IS NULL OR expected_layer IN ('sales_brief', 'bid_detail', 'company_reference', 'research')
  )
);

-- Indexes
CREATE INDEX idx_guides_slug ON guides(slug);
CREATE INDEX idx_guides_type ON guides(guide_type);
CREATE INDEX idx_guide_sections_guide_id ON guide_sections(guide_id);
CREATE INDEX idx_guide_sections_order ON guide_sections(guide_id, display_order);

-- RLS policies (same pattern as other tables)
ALTER TABLE guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_sections ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read published guides
CREATE POLICY "Authenticated users can read published guides"
  ON guides FOR SELECT TO authenticated
  USING (is_published = true);

-- Admins can read all guides (including unpublished)
CREATE POLICY "Admins can read all guides"
  ON guides FOR SELECT TO authenticated
  USING ((SELECT get_user_role()) IN ('admin'));

-- Editors and admins can manage guides
CREATE POLICY "Editors and admins can insert guides"
  ON guides FOR INSERT TO authenticated
  WITH CHECK ((SELECT get_user_role()) IN ('admin', 'editor'));

CREATE POLICY "Editors and admins can update guides"
  ON guides FOR UPDATE TO authenticated
  USING ((SELECT get_user_role()) IN ('admin', 'editor'));

-- Admin-only delete
CREATE POLICY "Admins can delete guides"
  ON guides FOR DELETE TO authenticated
  USING ((SELECT get_user_role()) IN ('admin'));

-- Guide sections inherit access from parent guide
CREATE POLICY "Authenticated users can read guide sections"
  ON guide_sections FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM guides g
    WHERE g.id = guide_sections.guide_id
    AND (g.is_published = true OR (SELECT get_user_role()) IN ('admin'))
  ));

CREATE POLICY "Editors and admins can manage guide sections"
  ON guide_sections FOR ALL TO authenticated
  USING ((SELECT get_user_role()) IN ('admin', 'editor'));
