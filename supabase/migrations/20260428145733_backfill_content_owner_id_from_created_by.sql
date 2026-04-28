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

-- ─────────────────────────────────────────────
-- Step 1 — UPDATE content_items
-- ─────────────────────────────────────────────

UPDATE public.content_items ci
SET
  content_owner_id = ci.created_by,
  updated_at = now()
WHERE ci.content_owner_id IS NULL
  AND ci.created_by IS NOT NULL
  AND ci.created_by <> ALL (ARRAY['a0000000-0000-4000-8000-000000000001']::uuid[]);

-- ─────────────────────────────────────────────
-- Step 2 — content_history audit row per affected item
-- ─────────────────────────────────────────────
--
-- The set_content_history_version trigger (function
-- auto_version_content_history) overwrites the explicit `version` value
-- with `MAX(version)+1` per content_item_id, so any non-null value here
-- is acceptable. We pass `1` as a placeholder to satisfy the NOT NULL
-- column constraint pre-trigger.
--
-- We identify "items just affected by step 1" via the 5-minute updated_at
-- window — restricted to rows where content_owner_id is now equal to
-- created_by (the post-condition of the backfill).

INSERT INTO public.content_history (
  content_item_id, version, title, content,
  change_type, change_reason, change_summary,
  created_by, metadata
)
SELECT
  ci.id,
  1,
  ci.title,
  ci.content,
  'owner_change',
  'backfill_owner_assign_wp_a3',
  'Backfill: content_owner_id auto-assigned to created_by per WP-A3',
  ci.created_by,
  jsonb_build_object('backfill', true, 'wp', 'WP-A3')
FROM public.content_items ci
WHERE ci.content_owner_id = ci.created_by
  AND ci.updated_at > now() - interval '5 minutes';
