-- ID-64.3 / BUG-C (S297) — make the canonical write-path FK checks deferrable.
--
-- The cocoindex per-item pipeline (scripts/cocoindex_pipeline/flow.py
-- _ingest_file_body) declares the parent content_items row AND its child rows
-- (content_chunks / q_a_extractions / entity_mentions) inside ONE per-item unit
-- of work, then the engine flushes the staged declare_row upserts across the
-- mounted targets. The cross-target flush ORDER is NOT guaranteed, so a child
-- row can be flushed before its parent content_items row exists -> the
-- non-deferrable FK fails mid-transaction -> the whole item's writes roll back.
-- This is the S296 live-smoke "all content rolls back" symptom (BUG-C).
--
-- Fix: make the child->content_items FKs DEFERRABLE INITIALLY DEFERRED so the FK
-- is checked at COMMIT (by which point the parent row exists), not per-statement.
-- ALTER CONSTRAINT only changes deferrability; each ON DELETE action (CASCADE /
-- SET NULL) is preserved and no row re-validation is required.

ALTER TABLE public.content_chunks
  ALTER CONSTRAINT content_chunks_content_item_id_fkey DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.entity_mentions
  ALTER CONSTRAINT entity_mentions_content_item_id_fkey DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.q_a_extractions
  ALTER CONSTRAINT q_a_extractions_source_content_item_id_fkey DEFERRABLE INITIALLY DEFERRED;

-- ID-64.3 (held since S296): add the content_items -> source_documents FK, also
-- DEFERRABLE INITIALLY DEFERRED -- same flush-order class (source_documents is
-- the parent, declared before content_items at flow.py, but the cross-target
-- flush order is not guaranteed). ON DELETE SET NULL per the {64.3} contract:
-- deleting a source_documents row SET-NULLs dependent content_items rather than
-- cascade-deleting the canonical record. Safe to add validating immediately:
-- the orphan precheck returned 0 and no FK currently exists on this column
-- (both verified read-only against prod, S297).
ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_source_document_id_fkey
  FOREIGN KEY (source_document_id) REFERENCES public.source_documents(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
