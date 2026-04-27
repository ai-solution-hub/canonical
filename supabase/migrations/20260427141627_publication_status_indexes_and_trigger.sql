-- §5.2 Phase 1g — Partial indexes + bidirectional archive-state trigger.
--
-- Two payloads:
--   1. Three partial indexes per spec §4.3 covering the three hottest
--      visibility-filter access paths:
--        - idx_content_items_publication_status_published
--          (default search; matches WHERE publication_status='published').
--        - idx_content_items_published_recent
--          (browse default; published rows ordered by created_at DESC).
--        - idx_content_items_archived
--          (admin-archive views; archived rows ordered by archived_at DESC).
--      Per Supabase Postgres best-practice (`query-partial-indexes`,
--      HIGH impact, 5–20× smaller indexes vs. full).
--
--   2. The `enforce_archive_state_consistency` trigger function + BEFORE
--      UPDATE trigger on content_items per spec §6.6. Bidirectional
--      enforcement of the invariant
--        publication_status='archived' ↔ archived_at IS NOT NULL
--      across four directions:
--        Direction 1: publication_status set → 'archived' → set archived_at = NOW()
--        Direction 2: publication_status moves AWAY from 'archived' → clear archived_at
--        Direction 3: archived_at set non-NULL by legacy path → set publication_status='archived'
--        Direction 4: archived_at cleared but publication_status='archived' → RAISE NOTICE
--                     and leave publication_status='archived' (defensive: better
--                     stale-hidden than stale-visible)
--
--      Direction 3 bridges three legacy archive paths that today write
--      `archived_at` directly without touching `publication_status`:
--        - app/api/items/[id]/archive/route.ts
--        - lib/mcp/tools/governance.ts delete_content_item archive mode
--        - lib/supersession/set.ts (per §6.5 wiring)
--
-- Pre-flight introspection 27/04/2026 against `rovrymhhffssilaftdwd`:
--   - Only constraint matching '%archive_state%' or '%publication_status%' is
--     content_items_publication_status_check (added in T1).
--   - No existing function named '*archive*' beyond pg_catalog built-ins
--     (pg_stat_get_archiver, pg_ls_archive_statusdir).
--   - No existing trigger on content_items beyond the unrelated
--     set_content_items_updated_at, trg_content_items_ensure_v1_history,
--     trg_validate_layer_key.
--   ⇒ No drift between spec §6.6 and live state. Safe to ADD the new
--     trigger function + trigger without DROP IF EXISTS gymnastics.
--
-- The function declares `SET search_path = public, extensions` per
-- CLAUDE.md "Function search_path" rule — required for all new PL/pgSQL
-- functions.
--
-- Spec sections: §4.3 (indexes), §6.6 (trigger), §10.1 Phase 1g.
-- Plan: T4.
-- Acceptance criteria: AC1.10 (Direction 1), AC1.11 (Direction 3),
--   AC1.12 (Direction 4), AC6.4 (direct SQL UPDATE bypasses app),
--   AC8.2 (query planner selects partial indexes).

-- -----------------------------------------------------------------------
-- Partial indexes (spec §4.3)
-- -----------------------------------------------------------------------

-- Primary index for default search filter (publication_status='published').
CREATE INDEX IF NOT EXISTS idx_content_items_publication_status_published
  ON public.content_items (publication_status)
  WHERE publication_status = 'published';

-- Composite index for browse default (published + ordered by recency).
CREATE INDEX IF NOT EXISTS idx_content_items_published_recent
  ON public.content_items (publication_status, created_at DESC)
  WHERE publication_status = 'published';

-- Index for archive-state queries (admin views).
CREATE INDEX IF NOT EXISTS idx_content_items_archived
  ON public.content_items (publication_status, archived_at DESC)
  WHERE publication_status = 'archived';

-- -----------------------------------------------------------------------
-- Bidirectional enforce_archive_state_consistency trigger (spec §6.6)
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_archive_state_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  -- Direction 1: publication_status set to 'archived' → ensure archived_at populated
  IF NEW.publication_status = 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := NOW();
  END IF;

  -- Direction 2: publication_status changes AWAY from 'archived' → clear archived_at
  IF NEW.publication_status != 'archived' AND OLD.publication_status = 'archived' THEN
    NEW.archived_at := NULL;
  END IF;

  -- Direction 3: archived_at set non-NULL by legacy path → ensure publication_status='archived'
  -- This handles: app/api/items/[id]/archive/route.ts (primary archive route),
  -- lib/mcp/tools/governance.ts delete_content_item archive mode,
  -- lib/supersession/set.ts (per §6.5 wiring).
  IF NEW.archived_at IS NOT NULL
     AND (OLD.archived_at IS NULL OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
     AND NEW.publication_status != 'archived'
  THEN
    NEW.publication_status := 'archived';
  END IF;

  -- Direction 4: archived_at cleared by legacy path → require explicit publication_status restore
  -- Auto-restoring publication_status would lose information (was it 'published' or 'draft'?
  -- Legacy un-archive paths don't track this). Instead, raise NOTICE and leave publication_status
  -- as-is. Production code MUST update publication_status explicitly when un-archiving.
  IF NEW.archived_at IS NULL
     AND OLD.archived_at IS NOT NULL
     AND NEW.publication_status = 'archived'
  THEN
    RAISE NOTICE 'enforce_archive_state_consistency: archived_at cleared but publication_status remains ''archived''. Caller must set publication_status explicitly to ''published'' or ''draft''. Item: %', NEW.id;
    -- Defensive: leave publication_status='archived' so item remains hidden until app fixes it
    -- (better stale-hidden than stale-visible)
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_archive_state_consistency() IS
  'Bidirectional invariant: publication_status=''archived'' ↔ archived_at IS NOT NULL. Per §5.2 spec §6.6. Four directions documented inline.';

DROP TRIGGER IF EXISTS trg_enforce_archive_state_consistency ON public.content_items;

CREATE TRIGGER trg_enforce_archive_state_consistency
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_archive_state_consistency();
