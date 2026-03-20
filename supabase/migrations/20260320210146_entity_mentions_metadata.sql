-- Add metadata JSONB column to entity_mentions
ALTER TABLE entity_mentions
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN entity_mentions.metadata
  IS 'Structured metadata for entity-level properties. For certifications: version, issuing_body, expiry_date, scope, certificate_number, holder. For frameworks: round, status, expiry_date, lot, supplier_id.';

-- Index for querying entities with expiry dates
CREATE INDEX idx_entity_mentions_metadata_expiry
  ON entity_mentions ((metadata->>'expiry_date'))
  WHERE metadata->>'expiry_date' IS NOT NULL;
