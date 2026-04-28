-- WP-A4 Option D: promote ingest provenance from JSONB metadata to typed
-- column, simplifying the v1 history trigger.
--
-- Spec:    docs/specs/ingest-path-consistency-spec.md §4.4
-- Plan:    docs/plans/ingest-path-consistency-plan.md Task 3.1
-- ACs:     3.1-AC1 .. 3.1-AC5

-- (a) Add the column. No DEFAULT, no NOT NULL, no CHECK initially. CHECK is
-- deferred to Task 3.6 per spec §10.4 (uses `NOT VALID` + `VALIDATE
-- CONSTRAINT` to avoid table-rewriting locks on prod).
ALTER TABLE public.content_items
  ADD COLUMN ingest_source text;

-- (b) Document the canonical value set (11 values per spec §3.4 AC4.1).
-- Note: 10 of 11 are written by INSERT-time code paths in S204 WP-A4
-- (`'batch_reclassify'` reserved for the EP7 UPDATE path — out of scope per
-- plan §3.3).
COMMENT ON COLUMN public.content_items.ingest_source IS
  'Canonical ingest provenance. One of {manual, url_import, upload, upload_autosplit, mcp_create, rss_feed, bid_outcome_integration, python_url, python_markdown, qa_import, batch_reclassify}. Read by trg_content_items_ensure_v1_history to set content_history.change_reason. See docs/specs/ingest-path-consistency-spec.md §4.4.';

-- (c) Replace the trigger function. The new function reads NEW.ingest_source
-- and writes change_reason accordingly. Behaviour preserved for the (legacy)
-- NULL ingest_source case — those still emit change_reason =
-- 'auto_v1_on_insert' as today.
--
-- Wave 3 fix M-4: previous draft had dead-code overwrite of v_change_reason
-- (assigned via COALESCE then unconditionally re-assigned via IF block).
-- Simplified to a single CASE expression — no behaviour change, semantics
-- preserved.
--
-- AC3.1-AC4: granular observability via metadata.ingest_source on the v1 row
-- (so a single change_reason='initial_ingest' label still allows per-path
-- breakdown via `metadata->>'ingest_source'` group-by).
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

  -- Single CASE expression (Wave 3 fix M-4): if ingest_source is set, emit
  -- canonical 'initial_ingest'; otherwise fall back to legacy
  -- 'auto_v1_on_insert' for null/legacy rows.
  v_change_reason := CASE
    WHEN NEW.ingest_source IS NOT NULL THEN 'initial_ingest'
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
      'ingest_source', NEW.ingest_source,
      'trigger_name', 'trg_content_items_ensure_v1_history'
    ),
    COALESCE(NEW.created_by, 'a0000000-0000-4000-8000-000000000001'::uuid),
    NEW.created_at
  );
  RETURN NULL;
END;
$$;

-- (d) Embed literal S186 rollback body in the function COMMENT so rollback is
-- one psql command, not a git archaeology exercise (Wave 3 fix L-5). The
-- S186 body below is reconstructed verbatim from migration
-- 20260422060118_ensure_content_items_v1_history.sql.
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

Then drop the column: ALTER TABLE public.content_items DROP COLUMN ingest_source;

Note: the literal S186 body above is reconstructed from the migration file
20260422060118_ensure_content_items_v1_history.sql; verify against that
migration before rollback.
$ROLLBACK$;

-- (e) Trigger declaration unchanged — already DEFERRABLE INITIALLY DEFERRED
-- + AFTER INSERT FOR EACH ROW from S186. CREATE OR REPLACE on the function
-- alone is sufficient.
