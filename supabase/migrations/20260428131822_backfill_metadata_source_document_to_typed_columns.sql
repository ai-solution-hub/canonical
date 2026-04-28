-- S205 WP-A1 Phase 1 (spec §3.1 AC1.3 + §8.2): copy-forward backfill
-- of legacy `metadata.source_document` JSONB blob to the typed columns
-- `content_items.source_url` and `content_items.source_file`.
--
-- Disambiguation rule (per spec §3.1 AC1.3, ratified Wave 3 fix L-6):
--   If the legacy value matches `^https?://` (case-insensitive) → copy to
--   typed `source_url` column.
--   Otherwise (file paths, relative paths, opaque tokens) → copy to typed
--   `source_file` column.
--
-- Idempotency:
--   `WHERE source_url IS NULL` / `WHERE source_file IS NULL` clauses make
--   the backfill safe to re-run. Typed values already present are never
--   overwritten.
--
-- Pre-flight (production rovrymhhffssilaftdwd, 28/04/2026):
--   - 23 rows have `metadata.source_document` set.
--   - 0 rows match URL regex (would copy to source_url).
--   - 23 rows are filenames (would copy to source_file).
--   - All 23 net writes (no typed source_file already set).
--   Staging (turayklvaunphgbgscat): 0 rows.
--
-- Application discipline (per plan §5 + §6.2):
--   This migration file is committed in S205 WP-A Phase 1. Apply order:
--   staging FIRST (turayklvaunphgbgscat), verify counts, then prod
--   (rovrymhhffssilaftdwd). Application is the main session's
--   responsibility post-merge.
--
-- Rollback:
--   The legacy `metadata->>'source_document'` JSONB key is preserved
--   on disk per AC1.4; reverting to the old behaviour requires only a
--   targeted UPDATE that NULLs the typed columns where they came from
--   the backfill (filterable by audit-trail timing).

-- 1. Copy URL-shaped legacy values to typed source_url.
UPDATE content_items
SET source_url = metadata->>'source_document'
WHERE source_url IS NULL
  AND metadata->>'source_document' IS NOT NULL
  AND metadata->>'source_document' ~* '^https?://';

-- 2. Copy non-URL legacy values to typed source_file.
UPDATE content_items
SET source_file = metadata->>'source_document'
WHERE source_file IS NULL
  AND metadata->>'source_document' IS NOT NULL
  AND metadata->>'source_document' !~* '^https?://';
