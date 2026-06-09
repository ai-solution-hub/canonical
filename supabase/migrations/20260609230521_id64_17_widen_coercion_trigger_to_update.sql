-- ID-64.17 follow-up — widen classification empty-string coercion to UPDATE.
-- Checker note on bl-42 (migration 20260609225144): the BEFORE INSERT trigger
-- left two unguarded UPDATE write paths able to store '' instead of NULL:
--   - cocoindex declare_row upsert's ON CONFLICT DO UPDATE phase, and
--   - lib/queue/handlers/batch-reclassify.ts explicit .update().
--
-- Fix: re-fire the SAME coercion on UPDATE as well as INSERT. The function body
-- (NULLIF on the four classification columns) is row-shape-only and references no
-- TG_OP, so its semantics are identical on UPDATE — no function edit is needed.
-- We DROP + recreate the trigger so the timing clause widens to BEFORE INSERT OR
-- UPDATE. CREATE OR REPLACE FUNCTION below keeps the migration self-contained and
-- idempotent (mirrors the original's style); the REVOKE re-asserts the
-- not-directly-invocable guard.
--
-- Semantics on the NOT NULL columns (primary_domain / primary_subtopic): an
-- UPDATE that sets '' coerces to NULL and is then rejected by the existing NOT
-- NULL constraint — the same belt-and-braces outcome as on INSERT.
CREATE OR REPLACE FUNCTION public.coerce_empty_classification_to_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.primary_domain := NULLIF(NEW.primary_domain, '');
  NEW.primary_subtopic := NULLIF(NEW.primary_subtopic, '');
  NEW.secondary_domain := NULLIF(NEW.secondary_domain, '');
  NEW.secondary_subtopic := NULLIF(NEW.secondary_subtopic, '');
  RETURN NEW;
END;
$$;

-- Trigger functions must not be directly invocable.
REVOKE EXECUTE ON FUNCTION public.coerce_empty_classification_to_null() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_coerce_empty_classification_to_null ON public.content_items;
CREATE TRIGGER trg_coerce_empty_classification_to_null
  BEFORE INSERT OR UPDATE ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION public.coerce_empty_classification_to_null();
