-- ID-64.17 (Lane-A G5 fold) — pre-ID-45-run schema housekeeping.
-- Folds two ratified backlog items (ID-93 §6.6, 08/06/2026):
--   bl-42: DB-layer empty-string coercion for the four classification text columns.
--   bl-43: content_item_workspaces primary-key constraint rename (cosmetic carry-over).

-- ---------------------------------------------------------------------------
-- bl-42 — empty-string -> NULL coercion for classification text columns.
--
-- Belt-and-braces DB guard complementing the S182 script-layer fix
-- (scripts/keyword_classifier.py returns None; write paths use `pair.get(...) or None`).
-- This BEFORE INSERT trigger protects against any *external* producer (other scripts,
-- MCP writers, direct SQL) that might write '' instead of NULL into the classification
-- columns, so the fresh ID-45 corpus is consistent.
--
-- Semantics: NULLIF(col, '') on all four columns.
--   - secondary_domain / secondary_subtopic are nullable -> '' cleanly coerces to NULL.
--   - primary_domain / primary_subtopic are NOT NULL -> an empty-string insert coerces
--     to NULL and is then correctly rejected by the existing NOT NULL constraint, rather
--     than silently storing ''. This is the intended belt-and-braces outcome: an item with
--     no primary classification is invalid and must not enter the corpus.
-- BEFORE INSERT only (per brief). Updates are out of scope.
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
  BEFORE INSERT ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION public.coerce_empty_classification_to_null();

-- ---------------------------------------------------------------------------
-- bl-43 — rename carried-over PK constraint name.
--
-- Table content_item_projects was renamed content_item_workspaces in an earlier session,
-- but the primary-key constraint kept the old name (content_item_projects_pkey). Purely
-- cosmetic — the constraint functions correctly — but rename for consistency while other
-- pre-run DDL lands.
ALTER TABLE public.content_item_workspaces
  RENAME CONSTRAINT content_item_projects_pkey TO content_item_workspaces_pkey;
