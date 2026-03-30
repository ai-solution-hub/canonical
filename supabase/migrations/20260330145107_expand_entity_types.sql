-- Expand entity_mentions entity_type CHECK constraint to include 'standard' and 'methodology'
-- Phase 1 of classification pipeline enhancement

-- 1. Drop and recreate the CHECK constraint with new types
ALTER TABLE entity_mentions DROP CONSTRAINT IF EXISTS entity_mentions_entity_type_check;

ALTER TABLE entity_mentions ADD CONSTRAINT entity_mentions_entity_type_check
  CHECK (entity_type IN (
    'organisation', 'certification', 'regulation', 'framework',
    'capability', 'person', 'technology', 'project', 'sector',
    'product', 'standard', 'methodology'
  ));

-- 2. First pass: reclassify existing entities to correct CURRENT types

-- Frameworks -> correct types
UPDATE entity_mentions SET entity_type = 'capability'
WHERE canonical_name = 'Agile' AND entity_type = 'framework';

UPDATE entity_mentions SET entity_type = 'certification'
WHERE canonical_name = 'DUNS Number' AND entity_type = 'framework';

UPDATE entity_mentions SET entity_type = 'technology'
WHERE canonical_name = 'Hl7' AND entity_type = 'framework';

UPDATE entity_mentions SET entity_type = 'certification'
WHERE canonical_name = 'ISO 27001' AND entity_type = 'framework';

UPDATE entity_mentions SET entity_type = 'capability'
WHERE canonical_name = 'Principle of Least Privilege' AND entity_type = 'framework';

-- Regulations -> correct types
UPDATE entity_mentions SET entity_type = 'certification'
WHERE canonical_name IN ('BS 3115', 'BS 5306', 'BS 5445', 'BS 5588', 'BS 5839', 'BS 6266')
  AND entity_type = 'regulation';

UPDATE entity_mentions SET entity_type = 'certification'
WHERE canonical_name LIKE 'SIC Code%' AND entity_type = 'regulation';

UPDATE entity_mentions SET entity_type = 'certification'
WHERE canonical_name LIKE 'VAT Registration%' AND entity_type = 'regulation';

UPDATE entity_mentions SET entity_type = 'technology'
WHERE canonical_name = 'WCAG 2.1 AA' AND entity_type = 'regulation';

-- Delete poorly normalised duplicate
DELETE FROM entity_mentions
WHERE id = '153f1c4d-faa5-4b00-aa55-d5a81fedd249';

-- Merge canonical name duplicates
UPDATE entity_mentions SET canonical_name = 'Keeping Children Safe in Education'
WHERE canonical_name IN ('Kcsie', 'Keeping Children Safe In Education');

UPDATE entity_mentions SET canonical_name = 'Children Act 2004 Section 11'
WHERE canonical_name IN ('Children Act Section 11', 'Section 11 Safeguarding');

UPDATE entity_mentions SET canonical_name = 'Education Act 2002 Sections 175/157'
WHERE canonical_name IN ('Education Act Section 175 157', 'Sections 175 157 Safeguarding');

-- 3. Second pass: reclassify to correct NEW types (now that CHECK allows them)
UPDATE entity_mentions SET entity_type = 'methodology'
WHERE canonical_name = 'Agile' AND entity_type = 'capability';

UPDATE entity_mentions SET entity_type = 'methodology'
WHERE canonical_name = 'Principle of Least Privilege' AND entity_type = 'capability';

UPDATE entity_mentions SET entity_type = 'standard'
WHERE canonical_name IN ('BS 3115', 'BS 5306', 'BS 5445', 'BS 5588', 'BS 5839', 'BS 6266')
  AND entity_type = 'certification';

UPDATE entity_mentions SET entity_type = 'standard'
WHERE canonical_name = 'WCAG 2.1 AA' AND entity_type = 'technology';

UPDATE entity_mentions SET entity_type = 'standard'
WHERE canonical_name = 'Hl7' AND entity_type = 'technology';
