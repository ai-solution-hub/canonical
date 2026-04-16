-- =============================================================================
-- Part A: classification_disputes table
-- =============================================================================

SET search_path TO public, extensions;

CREATE TABLE classification_disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id   uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  disputed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  disputed_field    text NOT NULL CHECK (disputed_field IN (
                      'primary_domain', 'primary_subtopic',
                      'secondary_domain', 'secondary_subtopic',
                      'primary_layer', 'content_type', 'entity_type'
                    )),
  current_value     jsonb NOT NULL DEFAULT 'null'::jsonb,
  proposed_value    jsonb,
  rationale         text NOT NULL CHECK (length(trim(rationale)) >= 10),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'rejected')),
  resolved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  resolution_notes  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT classification_disputes_resolution_complete
    CHECK (
      (status = 'open' AND resolved_by IS NULL AND resolved_at IS NULL)
      OR
      (status IN ('resolved', 'rejected') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

CREATE INDEX idx_classification_disputes_item
  ON classification_disputes(content_item_id);
CREATE INDEX idx_classification_disputes_status_created
  ON classification_disputes(status, created_at DESC)
  WHERE status = 'open';
CREATE INDEX idx_classification_disputes_disputed_by
  ON classification_disputes(disputed_by);
CREATE INDEX idx_classification_disputes_resolved_by
  ON classification_disputes(resolved_by)
  WHERE resolved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_classification_disputes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_classification_disputes_updated_at_trigger
  BEFORE UPDATE ON classification_disputes
  FOR EACH ROW EXECUTE FUNCTION public.set_classification_disputes_updated_at();

ALTER TABLE classification_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classification_disputes_select_admin"
  ON classification_disputes FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

CREATE POLICY "classification_disputes_select_own"
  ON classification_disputes FOR SELECT TO authenticated
  USING (public.get_user_role() = 'editor' AND disputed_by = auth.uid());

CREATE POLICY "classification_disputes_insert"
  ON classification_disputes FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() IN ('admin', 'editor')
    AND disputed_by = auth.uid()
    AND status = 'open'
    AND resolved_by IS NULL
    AND resolved_at IS NULL
    AND resolution_notes IS NULL
  );

CREATE POLICY "classification_disputes_update_admin"
  ON classification_disputes FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

CREATE POLICY "classification_disputes_delete_admin_rejected_only"
  ON classification_disputes FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin' AND status = 'rejected');

COMMENT ON TABLE classification_disputes IS
  'User/admin disputes of classification decisions. Wave A stub tab; Wave C HITL workflow.';
COMMENT ON COLUMN classification_disputes.current_value IS
  'JSONB snapshot of the disputed classification at dispute-creation time; shape depends on disputed_field.';
COMMENT ON COLUMN classification_disputes.proposed_value IS
  'Optional user-proposed correction; JSONB shape mirrors current_value.';
COMMENT ON COLUMN classification_disputes.disputed_by IS
  'Disputing user. Nullable so auth.users purges succeed; NULL indicates a purged user. INSERT RLS enforces non-null at write time.';

-- =============================================================================
-- Part B: per-item cost/token columns on content_items
-- =============================================================================

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS classification_model text,
  ADD COLUMN IF NOT EXISTS classification_tokens_in int,
  ADD COLUMN IF NOT EXISTS classification_tokens_out int,
  ADD COLUMN IF NOT EXISTS classification_cache_creation_tokens int,
  ADD COLUMN IF NOT EXISTS classification_cache_read_tokens int,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedding_tokens int;

-- ROLLBACK:
-- DROP TRIGGER IF EXISTS set_classification_disputes_updated_at_trigger ON classification_disputes;
-- DROP FUNCTION IF EXISTS public.set_classification_disputes_updated_at();
-- DROP TABLE IF EXISTS classification_disputes;
-- ALTER TABLE content_items DROP COLUMN IF EXISTS classification_model, DROP COLUMN IF EXISTS classification_tokens_in, DROP COLUMN IF EXISTS classification_tokens_out, DROP COLUMN IF EXISTS classification_cache_creation_tokens, DROP COLUMN IF EXISTS classification_cache_read_tokens, DROP COLUMN IF EXISTS embedding_model, DROP COLUMN IF EXISTS embedding_tokens;
