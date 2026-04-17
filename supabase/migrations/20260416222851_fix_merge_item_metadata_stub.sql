-- Fix merge_item_metadata stub from S176 migration squash.
-- The squashed migration created a placeholder returning '{}'::jsonb; the real
-- implementation in production performs a JSONB merge UPDATE. Caller in
-- scripts/kb_pipeline/store.py uses p_item_id / p_new_data param names.

DROP FUNCTION IF EXISTS public.merge_item_metadata(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.merge_item_metadata(p_item_id uuid, p_new_data jsonb)
RETURNS void
LANGUAGE sql
SET search_path = public, extensions
AS $$
  UPDATE content_items
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_new_data,
      updated_at = now()
  WHERE id = p_item_id;
$$;
