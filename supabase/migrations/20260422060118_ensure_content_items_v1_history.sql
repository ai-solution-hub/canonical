-- S186 WP-E: structural prevention for v1 content_history gap.
--
-- Context: S186 WP-A quality gate surfaced 475 real-content items on
-- production without a v1 content_history row. Root causes:
--
--   1. Pre-S153 Python ingest scripts wrote `content_items` but not
--      `content_history`. Closed S153 via `insert_content_history_entry`
--      and hardened S185 WP-D via the shared `post_insert.py` helper.
--   2. `lib/mcp/tools/content.ts::create_content_item` never wrote v1
--      history (active bug through S186). Patched this session.
--   3. No DB-level guarantee that a `content_items` row has a paired v1
--      `content_history` row. Fixed by this migration.
--
-- Design: a DEFERRED CONSTRAINT TRIGGER ensures that, at transaction
-- commit time, every content_items row has at least one v1 history row.
-- If the app has already written a v1 (e.g. the 4 TS ingest routes + the
-- MCP tool patched this session), the trigger is a no-op. If the app
-- forgot (a new ingest path, a raw SQL insert, a migration loading seed
-- data), the trigger backfills a v1 row tagged `change_reason = 'auto_v1_on_insert'`
-- so future auditors can distinguish trigger-written rows from app-written
-- ones.
--
-- Observability: a `SELECT change_reason, COUNT(*) FROM content_history
-- WHERE version = 1 GROUP BY 1` query now tells operators which ingest
-- paths produced v1 history and which relied on the trigger. A growing
-- count of `auto_v1_on_insert` is a signal that a new insert path has
-- skipped the explicit write — investigate and fix.

CREATE OR REPLACE FUNCTION public.ensure_v1_history_at_commit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
  v_v1_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.content_history
    WHERE content_item_id = NEW.id AND version = 1
  )
  INTO v_v1_exists;

  IF NOT v_v1_exists THEN
    INSERT INTO public.content_history (
      content_item_id,
      version,
      title,
      content,
      brief,
      detail,
      reference,
      change_type,
      change_reason,
      change_summary,
      metadata,
      created_by,
      created_at
    ) VALUES (
      NEW.id,
      1,
      COALESCE(NEW.title, '(untitled)'),
      COALESCE(NEW.content, ''),
      NEW.brief,
      NEW.detail,
      NEW.reference,
      'create',
      'auto_v1_on_insert',
      'Auto-created v1 history row (no app-level write detected)',
      jsonb_build_object(
        'auto', true,
        'via', 'trigger',
        'trigger_name', 'trg_content_items_ensure_v1_history'
      ),
      COALESCE(
        NEW.created_by,
        'a0000000-0000-4000-8000-000000000001'::uuid
      ),
      NEW.created_at
    );
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.ensure_v1_history_at_commit() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.ensure_v1_history_at_commit()
  TO anon, authenticated, service_role;

-- DEFERRABLE INITIALLY DEFERRED — fires at transaction commit, giving
-- app-level code the chance to write its own v1 history row first. If
-- app wrote v1, the function's EXISTS check returns true and we noop.
CREATE CONSTRAINT TRIGGER trg_content_items_ensure_v1_history
AFTER INSERT ON public.content_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.ensure_v1_history_at_commit();

COMMENT ON FUNCTION public.ensure_v1_history_at_commit() IS
'Deferred constraint trigger function. Ensures every content_items row has a v1 content_history row at transaction commit time. See migration 20260422060118 for background.';

COMMENT ON TRIGGER trg_content_items_ensure_v1_history ON public.content_items IS
'Structural backstop (S186 WP-E) - if an ingest path forgets to write v1 history, this trigger writes one at transaction commit with change_reason = auto_v1_on_insert. Observability: SELECT change_reason, COUNT(*) FROM content_history WHERE version=1 GROUP BY 1 flags paths that rely on the backstop.';
