CREATE OR REPLACE FUNCTION toggle_star(p_item_id uuid, p_starred boolean)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE content_items
  SET metadata = CASE
    WHEN p_starred THEN COALESCE(metadata, '{}'::jsonb) || '{"starred": true}'::jsonb
    ELSE COALESCE(metadata, '{}'::jsonb) - 'starred'
  END,
  updated_at = now()
  WHERE id = p_item_id;
$$;
