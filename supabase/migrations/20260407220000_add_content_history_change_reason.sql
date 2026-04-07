-- S152B WP3 / Q-3: add `change_reason` to `content_history`
--
-- Background:
-- The bid side already has `bid_response_history.change_reason` (captures
-- WHY a version was created, e.g. "Restored from version 1"). The KB side
-- has only `change_summary` (a one-line description of WHAT changed) and
-- `change_type` (a category enum). There is no column to capture WHY a
-- change was made — the provenance gap Liam flagged in Q-3:
--
--   "the data we hold and the information we hold on it are key
--    differentiators for our platform"
--
-- Roadmap entry: §2.1.9 (elevated from low priority to pre-launch must).
-- Decision source: docs/audits/s151-decision-responses.md Q-3.
--
-- Scope of this migration:
--   1. Add `change_reason TEXT NULL` to `content_history`.
--   2. Backfill existing rows from `activity_history.action_type` where
--      possible — items created by the ingestion pipeline get stamped
--      `initial_ingest`; items edited via admin UI remain NULL (we cannot
--      reliably infer the why for historical edits).
--
-- Canonical `change_reason` values (convention, not enforced by CHECK):
--   - `initial_ingest` — first version created by the KB ingestion pipeline
--     (`scripts/ingest.py`, `scripts/ingest_markdown.py`,
--     `app/api/ingest/url`, `app/api/upload`).
--   - `reclassify` — classification pipeline re-run (scripts/batch-reclassify,
--     classification_quality cron, /api/items/[id]/classify endpoint).
--   - `entity_enrichment` — entity-mention or relationship backfill.
--   - `template_coverage_refresh` — template coverage job stamped a new version.
--   - `source_document_accepted` — source-document workflow accepted a diff.
--   - `owner_change` — content owner reassignment.
--   - `rollback_to_v<N>` — version rollback from the item detail UI.
--   - NULL — user edit via admin UI with no reason supplied (acceptable
--     default — the UI surfaces an optional "Why change?" input that
--     admins may or may not fill in).
--
-- The CHECK constraint is deliberately NOT added: future pipelines may
-- introduce new reasons, and the convention above is documented in
-- `docs/reference/data-entry-points.md` rather than enforced at the DB
-- layer.

BEGIN;

ALTER TABLE public.content_history
  ADD COLUMN IF NOT EXISTS change_reason text NULL;

COMMENT ON COLUMN public.content_history.change_reason IS
  'Why this version was created (S152B WP3). Free-text convention; see '
  'docs/reference/data-entry-points.md for the canonical enum-like values '
  '(initial_ingest, reclassify, entity_enrichment, template_coverage_refresh, '
  'source_document_accepted, owner_change, rollback_to_v<N>). NULL is '
  'acceptable when the caller did not supply a reason (e.g. admin UI edit '
  'with empty reason field) — distinct from change_summary which captures '
  'WHAT changed, and from change_type which categorises the change.';

-- Backfill attempt: use change_type to infer a coarse-grained change_reason
-- for historical rows where possible. This is best-effort — we cannot
-- reliably map every historical row to the new vocabulary because the
-- change_type column has been populated inconsistently over the life of
-- the table. The goal is to get the common cases covered so the new
-- column isn't uniformly NULL on day one.
UPDATE public.content_history
SET change_reason = CASE change_type
  WHEN 'create'          THEN 'initial_ingest'
  WHEN 'import'          THEN 'initial_ingest'
  WHEN 'ai_update'       THEN 'reclassify'
  WHEN 'owner_change'    THEN 'owner_change'
  WHEN 'rollback'        THEN 'rollback_legacy' -- we don't know which version
  -- 'edit', 'merge', 'archive', 'delete', 'metadata_change' → leave NULL
  -- (we don't have a principled inference)
  ELSE NULL
END
WHERE change_reason IS NULL;

COMMIT;
