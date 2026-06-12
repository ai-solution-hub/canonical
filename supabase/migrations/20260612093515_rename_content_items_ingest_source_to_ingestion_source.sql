-- ID-107.1 — Rename content_items.ingest_source → ingestion_source.
--
-- S236-ratified rename: collapses the Zod-field/DB-column naming split.
-- reference_items already uses `ingestion_source`; this aligns content_items.
--
-- Spec: S236 ratified rename (FORWARD CLOSED SET context — 6 values, validated
-- S342; enforcement is a later subtask, not this one).
--
-- Two changes, in ONE migration:
--   (a) ALTER TABLE … RENAME COLUMN.
--   (b) CREATE OR REPLACE the v1-history trigger function, updating the TWO
--       column reads of NEW.ingest_source → NEW.ingestion_source. The trigger
--       binding itself is unchanged (CREATE OR REPLACE on the function alone is
--       sufficient — the trigger references the function by name).

-- (a) Rename the column.
ALTER TABLE public.content_items RENAME COLUMN ingest_source TO ingestion_source;

-- (b) Replace the trigger function so it reads the renamed column. Body copied
-- verbatim from 20260428174512_add_ingest_source_to_content_items.sql with the
-- TWO column reads renamed; search_path, volatility, and the rollback COMMENT
-- preserved exactly.
CREATE OR REPLACE FUNCTION public.ensure_v1_history_at_commit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_v1_exists BOOLEAN;
  v_change_reason TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.content_history
    WHERE content_item_id = NEW.id AND version = 1
  ) INTO v_v1_exists;

  IF v_v1_exists THEN
    RETURN NULL;
  END IF;

  -- Single CASE expression (Wave 3 fix M-4): if ingestion_source is set, emit
  -- canonical 'initial_ingest'; otherwise fall back to legacy
  -- 'auto_v1_on_insert' for null/legacy rows.
  v_change_reason := CASE
    WHEN NEW.ingestion_source IS NOT NULL THEN 'initial_ingest'
    ELSE 'auto_v1_on_insert'
  END;

  INSERT INTO public.content_history (
    content_item_id, version, title, content,
    brief, detail, reference,
    change_type, change_reason, change_summary,
    metadata, created_by, created_at
  ) VALUES (
    NEW.id, 1,
    COALESCE(NEW.title, '(untitled)'),
    COALESCE(NEW.content, ''),
    NEW.brief, NEW.detail, NEW.reference,
    'create',
    v_change_reason,
    'v1 written by trg_content_items_ensure_v1_history',
    jsonb_build_object(
      'auto', true,
      'via', 'trigger',
      -- metadata key kept as 'ingest_source' for history-row continuity; underlying column renamed to ingestion_source
      'ingest_source', NEW.ingestion_source,
      'trigger_name', 'trg_content_items_ensure_v1_history'
    ),
    COALESCE(NEW.created_by, 'a0000000-0000-4000-8000-000000000001'::uuid),
    NEW.created_at
  );
  RETURN NULL;
END;
$$;

-- (c) Re-embed the literal S186 rollback body in the function COMMENT so
-- rollback stays one psql command (Wave 3 fix L-5). Preserved verbatim from
-- the predecessor migration.
COMMENT ON FUNCTION public.ensure_v1_history_at_commit() IS
$ROLLBACK$
WP-A4 Option D rewrite of the S186 deferred trigger function.

To roll back to the S186 design (pre-Option-D), execute:

  CREATE OR REPLACE FUNCTION public.ensure_v1_history_at_commit()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, extensions
  AS $S186$
  DECLARE
    v_v1_exists BOOLEAN;
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public.content_history
      WHERE content_item_id = NEW.id AND version = 1
    ) INTO v_v1_exists;

    IF v_v1_exists THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.content_history (
      content_item_id, version, title, content,
      brief, detail, reference,
      change_type, change_reason, change_summary,
      metadata, created_by, created_at
    ) VALUES (
      NEW.id, 1,
      COALESCE(NEW.title, '(untitled)'),
      COALESCE(NEW.content, ''),
      NEW.brief, NEW.detail, NEW.reference,
      'create',
      'auto_v1_on_insert',
      'Auto-created v1 history row (no app-level write detected)',
      jsonb_build_object(
        'auto', true,
        'via', 'trigger',
        'trigger_name', 'trg_content_items_ensure_v1_history'
      ),
      COALESCE(NEW.created_by, 'a0000000-0000-4000-8000-000000000001'::uuid),
      NEW.created_at
    );
    RETURN NULL;
  END;
  $S186$;

Then drop the column: ALTER TABLE public.content_items DROP COLUMN ingestion_source;

Note: the literal S186 body above is reconstructed from the migration file
20260422060118_ensure_content_items_v1_history.sql; verify against that
migration before rollback.
$ROLLBACK$;

-- Update the column COMMENT to reflect the rename (provenance documentation
-- only; no behaviour change).
COMMENT ON COLUMN public.content_items.ingestion_source IS
  'Canonical ingest provenance (renamed from ingest_source per S236). Read by trg_content_items_ensure_v1_history to set content_history.change_reason. Note: the v1-history metadata key remains ''ingest_source'' for history-row continuity.';
