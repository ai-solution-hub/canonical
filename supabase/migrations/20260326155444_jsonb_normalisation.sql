-- JSONB Normalisation: Promote 5 fields from JSONB metadata to proper columns
-- Fields: citation_count, source_file, layer, starred (content_items), overall_score (bid_responses)
-- Spec: docs/plans/jsonb-normalisation-spec.md

-- ══════════════════════════════════════════════════════════════════
-- 1.1 COLUMN ADDITIONS
-- ══════════════════════════════════════════════════════════════════

-- content_items: 4 new columns
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS citation_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS source_file TEXT;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS layer VARCHAR(50);

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;

-- bid_responses: 1 new column
ALTER TABLE bid_responses
  ADD COLUMN IF NOT EXISTS overall_score NUMERIC(5,1);

-- ══════════════════════════════════════════════════════════════════
-- 1.2 CONSTRAINTS
-- ══════════════════════════════════════════════════════════════════

-- citation_count must be non-negative
ALTER TABLE content_items
  ADD CONSTRAINT chk_content_items_citation_count_non_negative
  CHECK (citation_count >= 0);

-- overall_score range (0-100)
ALTER TABLE bid_responses
  ADD CONSTRAINT chk_bid_responses_overall_score_range
  CHECK (overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100));

-- layer validation via trigger (PostgreSQL does not support subqueries in CHECK)
CREATE OR REPLACE FUNCTION validate_layer_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.layer IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM layer_vocabulary WHERE key = NEW.layer) THEN
      RAISE EXCEPTION 'Invalid layer key: %. Must exist in layer_vocabulary.', NEW.layer;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_layer_key
  BEFORE INSERT OR UPDATE OF layer ON content_items
  FOR EACH ROW
  EXECUTE FUNCTION validate_layer_key();

-- ══════════════════════════════════════════════════════════════════
-- 1.3 BACKFILL FROM JSONB
-- ══════════════════════════════════════════════════════════════════

-- citation_count
UPDATE content_items
SET citation_count = COALESCE((metadata->>'citation_count')::INTEGER, 0)
WHERE metadata ? 'citation_count';

-- source_file
UPDATE content_items
SET source_file = metadata->>'source_file'
WHERE metadata ? 'source_file';

-- layer
UPDATE content_items
SET layer = metadata->>'layer'
WHERE metadata ? 'layer';

-- starred
UPDATE content_items
SET starred = true
WHERE metadata ? 'starred' AND metadata->>'starred' = 'true';

-- overall_score (nested in quality_data)
UPDATE bid_responses
SET overall_score = ((metadata->'quality_data'->>'overall_score')::NUMERIC)
WHERE metadata->'quality_data' ? 'overall_score';

-- ══════════════════════════════════════════════════════════════════
-- 1.4 INDEXES
-- ══════════════════════════════════════════════════════════════════

-- source_file: B-tree for review queue filtering, library filtering, provenance lookups
CREATE INDEX IF NOT EXISTS idx_content_items_source_file
  ON content_items (source_file)
  WHERE source_file IS NOT NULL;

-- layer: B-tree for browse filtering, coverage matrix, search post-filter
CREATE INDEX IF NOT EXISTS idx_content_items_layer
  ON content_items (layer)
  WHERE layer IS NOT NULL;

-- starred: partial index for "show starred only" filter
CREATE INDEX IF NOT EXISTS idx_content_items_starred
  ON content_items (id)
  WHERE starred = true;

-- overall_score: for sorting bid responses by quality
CREATE INDEX IF NOT EXISTS idx_bid_responses_overall_score
  ON bid_responses (overall_score DESC NULLS LAST)
  WHERE overall_score IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════
-- 1.5 TRIGGER AND RPC UPDATES
-- ══════════════════════════════════════════════════════════════════

-- Replace update_citation_count() to write to column instead of JSONB
CREATE OR REPLACE FUNCTION update_citation_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  target_id uuid;
  new_count int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_id := OLD.content_item_id;
  ELSE
    target_id := NEW.content_item_id;
  END IF;

  SELECT count(*)::int INTO new_count
  FROM content_citations
  WHERE content_item_id = target_id;

  -- Write to proper column instead of JSONB
  UPDATE content_items
  SET citation_count = new_count
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Replace toggle_star() to update column directly instead of JSONB manipulation
CREATE OR REPLACE FUNCTION toggle_star(p_item_id UUID, p_starred BOOLEAN)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE content_items
  SET starred = p_starred,
      updated_at = now()
  WHERE id = p_item_id;
$$;

-- Replace get_topic_layers() to use layer column instead of JSONB extraction
CREATE OR REPLACE FUNCTION get_topic_layers(p_topic_id text)
RETURNS TABLE (
  id uuid,
  title text,
  content_type text,
  primary_domain text,
  metadata jsonb,
  layer text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT DISTINCT ON (ci.layer)
    ci.id,
    ci.title,
    ci.content_type,
    ci.primary_domain,
    ci.metadata,
    ci.layer
  FROM content_items ci
  LEFT JOIN layer_vocabulary lv ON lv.key = ci.layer
  WHERE ci.metadata->>'topic_id' = p_topic_id
  ORDER BY ci.layer, COALESCE(lv.display_order, 999), ci.title;
$$;

-- Replace get_coverage_matrix() to use layer column + add search_path
CREATE OR REPLACE FUNCTION get_coverage_matrix(p_layer text DEFAULT NULL::text)
RETURNS TABLE(
  domain_name text,
  subtopic_name text,
  item_count bigint,
  fresh_count bigint,
  aging_count bigint,
  stale_count bigint,
  expired_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    d.name::text                                            AS domain_name,
    s.name::text                                            AS subtopic_name,
    COUNT(ci.id)                                            AS item_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'fresh')      AS fresh_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'aging')      AS aging_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'stale')      AS stale_count,
    COUNT(ci.id) FILTER (WHERE ci.freshness = 'expired')    AS expired_count
  FROM taxonomy_domains d
  INNER JOIN taxonomy_subtopics s ON s.domain_id = d.id AND s.is_active = TRUE
  LEFT JOIN content_items ci
    ON ci.primary_domain = d.name
    AND ci.primary_subtopic = s.name
    AND ci.archived_at IS NULL
    AND (ci.governance_review_status IS NULL OR ci.governance_review_status != 'draft')
    AND (p_layer IS NULL OR ci.layer = p_layer)
  WHERE d.is_active = TRUE
  GROUP BY d.name, s.name, d.display_order, s.display_order
  ORDER BY d.display_order, s.display_order;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════
-- 1.6 JSONB CLEANUP — Remove promoted keys from metadata
-- ══════════════════════════════════════════════════════════════════

-- Remove promoted keys from content_items metadata
UPDATE content_items
SET metadata = metadata - 'citation_count' - 'source_file' - 'layer' - 'starred'
WHERE metadata ?| ARRAY['citation_count', 'source_file', 'layer', 'starred'];

-- Remove overall_score from bid_responses metadata.quality_data (nested path)
UPDATE bid_responses
SET metadata = jsonb_set(
  metadata,
  '{quality_data}',
  (metadata->'quality_data') - 'overall_score'
)
WHERE metadata->'quality_data' ? 'overall_score';
