-- SI-L3: Align content_items.content_type CHECK constraint with VALID_CONTENT_TYPES
--
-- Background:
-- The application's canonical content_type values are defined in
-- lib/validation/schemas.ts (VALID_CONTENT_TYPES) and the pipeline's
-- inferContentType() (lib/intelligence/pipeline.ts) returns values like
-- 'research', 'compliance', 'certification', 'methodology', and 'policy'.
--
-- The legacy migration `20260326164302_security_performance_fixes.sql`
-- defined TWO check constraints on content_items.content_type:
--   1. content_items_content_type_check    — narrow set (article, note, document,
--                                              bookmark, q_a_pair, case_study,
--                                              policy, methodology, cv,
--                                              company_info)
--   2. content_items_valid_content_type    — expanded canonical set
--
-- The narrow constraint (1) was hand-removed from the live DB at some point but
-- the migration file still defines it, meaning a fresh DB rebuild would fail
-- to insert any value not in the narrow set. This migration aligns the schema
-- by guaranteeing only the canonical expanded constraint exists.
--
-- This migration is idempotent: it drops both possible legacy constraint names
-- (using IF EXISTS) and re-creates the canonical constraint.
--
-- Canonical list (must match VALID_CONTENT_TYPES in lib/validation/schemas.ts):
--   article, blog, pdf, note, research, other, q_a_pair, case_study, policy,
--   certification, compliance, methodology, capability, product_description,
--   document

BEGIN;

-- Drop legacy narrow constraint if present (hand-removed from prod, still in
-- legacy migration file).
ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_content_type_check;

-- Drop existing canonical constraint to allow idempotent re-creation.
ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_valid_content_type;

-- Re-create the canonical CHECK constraint matching VALID_CONTENT_TYPES.
ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_valid_content_type
  CHECK (
    (content_type)::text = ANY (
      ARRAY[
        'article'::text,
        'blog'::text,
        'pdf'::text,
        'note'::text,
        'research'::text,
        'other'::text,
        'q_a_pair'::text,
        'case_study'::text,
        'policy'::text,
        'certification'::text,
        'compliance'::text,
        'methodology'::text,
        'capability'::text,
        'product_description'::text,
        'document'::text
      ]
    )
  );

COMMENT ON CONSTRAINT content_items_valid_content_type ON public.content_items IS
  'Canonical content_type values. Must stay in sync with VALID_CONTENT_TYPES in lib/validation/schemas.ts. See SI-L3 fix.';

COMMIT;
