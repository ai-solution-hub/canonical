-- ============================================================
-- content_items.superseded_by — supersession model (S186 WP-B.1)
-- ============================================================
-- Minimum-viable supersession per docs/specs/supersession-model-spec.md §3.
-- Chains, branching, merges, cross-workspace semantics are deliberately
-- out of scope (§2). Supersession resolves the S183/S184 soft-block
-- direction: the new row replaces the old, search hides the old by
-- default, direct ID lookup still returns it.
--
-- Two things happen in this migration:
--   1. Widen the existing dedup_status CHECK to include 'superseded'
--      (spec Q3 — new enum value, not reuse of confirmed_duplicate).
--   2. Add superseded_by UUID FK + self-ref CHECK + partial index.
--
-- Reference: docs/specs/supersession-model-spec.md §3 + §13 Q3
-- Reference: supabase/migrations/20260421172733_add_dedup_status_to_content_items.sql
-- ============================================================

SET search_path = public, extensions;

-- ---------------------------------------------------------------
-- Step 1 — widen dedup_status CHECK to include 'superseded'
-- ---------------------------------------------------------------
-- The original constraint was added inline via ADD COLUMN ... CHECK (...)
-- so Postgres auto-named it. Resolve the actual name dynamically and
-- drop+recreate. Preserves all four existing values.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname
  INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.content_items'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%dedup_status%'
  ORDER BY conname
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.content_items DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;
END$$;

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_dedup_status_check
  CHECK (
    dedup_status IN (
      'clean',
      'suspected_duplicate',
      'confirmed_duplicate',
      'confirmed_unique',
      'superseded'
    )
  );

-- ---------------------------------------------------------------
-- Step 2 — add superseded_by column + self-ref CHECK + partial index
-- ---------------------------------------------------------------

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS superseded_by UUID
  REFERENCES public.content_items(id) ON DELETE SET NULL;

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_superseded_by_not_self
  CHECK (superseded_by IS NULL OR superseded_by <> id);

CREATE INDEX IF NOT EXISTS content_items_superseded_by_idx
  ON public.content_items (superseded_by)
  WHERE superseded_by IS NOT NULL;

COMMENT ON COLUMN public.content_items.superseded_by IS
  'UUID of the content_items row that supersedes this one. Minimum viable model per docs/specs/supersession-model-spec.md — chains, branches, merges, cross-workspace semantics all deliberately out of scope. NULL means "current". Default search filters this out unless the caller opts in via include_superseded=true.';
