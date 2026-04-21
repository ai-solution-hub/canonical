-- ============================================================
-- content_items.dedup_status — soft-block dedup flag (S183 WP2)
-- ============================================================
-- OPS-3 Phase 1 back-end. When a duplicate is detected at any entry
-- point we do NOT block the insert; we create the row and flag it
-- as suspected_duplicate. Humans reconcile via UI in a later phase.
--
-- Decision: soft block (Liam S182b Q1). Hard block was simpler but
-- blocks real writes and users dislike the surprise. Soft block
-- preserves the insert + surfaces a review signal.
--
-- Values (CHECK-enforced):
--   clean                  — default; no duplicate detected
--   suspected_duplicate    — exact-hash or title-norm match flagged at ingest
--   confirmed_duplicate    — admin-confirmed duplicate (UI workflow, S184)
--   confirmed_unique       — admin-reviewed, keep
--
-- Index is partial — most rows will be 'clean' so we only index the
-- interesting subset. Covers the admin "show me duplicates" query.
--
-- Reference: docs/specs/cross-system-dedup-spec.md
-- Reference: docs/continuation-prompts/continuation-prompt-kh-s183-*.md WP2
-- ============================================================

SET search_path = public, extensions;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS dedup_status TEXT NOT NULL DEFAULT 'clean'
  CHECK (
    dedup_status IN (
      'clean',
      'suspected_duplicate',
      'confirmed_duplicate',
      'confirmed_unique'
    )
  );

CREATE INDEX IF NOT EXISTS idx_content_items_dedup_status
  ON public.content_items (dedup_status)
  WHERE dedup_status <> 'clean';

COMMENT ON COLUMN public.content_items.dedup_status IS
  'S183 WP2 — OPS-3 Phase 1. Soft-block dedup flag. clean = default, suspected_duplicate = detected at ingest, confirmed_duplicate / confirmed_unique = admin-reviewed via UI (S184).';
