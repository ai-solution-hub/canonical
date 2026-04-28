-- S206 WP-A Phase 2 (AC3.4, AC3.5, AC3.9) — backfill content_owner_id
--
-- Spec: ingest-path-consistency-spec.md §3.3 / §4.3
--
-- For all content_items rows where:
--   - content_owner_id IS NULL
--   - created_by IS NOT NULL
--   - created_by is NOT in the service-account UUID list
-- set content_owner_id = created_by and emit a content_history audit row.
--
-- Service-account exclusion list (canonical, both staging + prod):
--   ['a0000000-0000-4000-8000-000000000001']
--
-- The migration is idempotent (`WHERE content_owner_id IS NULL` clause):
-- re-running on a populated table is a no-op.

-- WP-A3 (S206): default content_owner_id = created_by for human-authored rows.
-- Service-account rows remain NULL-owned (intentional — see spec §3.3 AC3.2).
-- CTE-based for atomicity + replay-safe idempotency (UPDATE drives audit INSERT directly).
--
-- Note on SQL form: `unnest(...)` exposes individual UUID values from the
-- service-account list so the `NOT IN (...)` predicate has a uuid:uuid
-- comparison (not uuid:uuid[]). Functionally equivalent to `<> ALL`.

WITH service_account_ids AS (
  SELECT unnest('{a0000000-0000-4000-8000-000000000001}'::uuid[]) AS uid
),
affected AS (
  UPDATE public.content_items ci
  SET
    content_owner_id = ci.created_by,
    updated_at = now()
  WHERE ci.content_owner_id IS NULL
    AND ci.created_by IS NOT NULL
    AND ci.created_by NOT IN (SELECT uid FROM service_account_ids)
  RETURNING id, created_by, title, content
)
INSERT INTO public.content_history (
  content_item_id, version, title, content,
  change_type, change_reason, change_summary,
  created_by, metadata
)
SELECT
  a.id,
  COALESCE((SELECT MAX(version) FROM content_history WHERE content_item_id = a.id), 1) + 1,
  a.title, a.content,
  'owner_change',
  'backfill_owner_assign_wp_a3',
  'Backfill: content_owner_id auto-assigned to created_by per WP-A3',
  a.created_by,
  jsonb_build_object('backfill', true, 'wp', 'WP-A3')
FROM affected a;
