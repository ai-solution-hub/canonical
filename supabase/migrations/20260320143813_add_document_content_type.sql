-- Add 'document' to valid content types on content_items.
-- Supports generic document ingestion (DOCX, uploaded documents, etc.)

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_valid_content_type;

ALTER TABLE content_items
  ADD CONSTRAINT content_items_valid_content_type
  CHECK (
    (content_type)::text = ANY ((ARRAY[
      'article'::character varying,
      'blog'::character varying,
      'pdf'::character varying,
      'note'::character varying,
      'research'::character varying,
      'other'::character varying,
      'q_a_pair'::character varying,
      'case_study'::character varying,
      'policy'::character varying,
      'certification'::character varying,
      'compliance'::character varying,
      'methodology'::character varying,
      'capability'::character varying,
      'product_description'::character varying,
      'document'::character varying
    ])::text[])
  );
