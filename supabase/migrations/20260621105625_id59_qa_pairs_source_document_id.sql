-- ID-59.27 — q_a_pairs.source_document_id uuid: FK-LESS sidecar linkage (INV-8, TECH M1)
--
-- Adds the nullable uuid column that links a corpus-extracted Q&A pair to its Q&A
-- sidecar source_documents row (uuid5-derived from `sd:<rel_path>`). The promotion leg
-- (R1) sets it by pair PK after the sidecar file + source_documents row exist; until then
-- (pre-emit, or a derived_from_form_response pair) it is NULL.
--
-- FK-LESS BY DESIGN (INV-8). There is deliberately NO `REFERENCES source_documents(id)`.
-- The cocoindex pipeline declares the source_documents row in a SEPARATE autocommit
-- target from the q_a_pairs UPDATE the promotion leg makes, so a real FK would fail the
-- same way the content_items -> source_documents FK did before it was DROPPED in
-- 20260602073942 (BUG-E; now folded into the 20260617130000 squash baseline). A PostgREST
-- embed through this relationship would likewise PGRST200 — linkage is resolved by two
-- plain reads (the writeBackFileFirst BUG-E pattern), never an embed.
--
-- ZERO-BACKFILL. q_a_pairs live count = 0 (the zero-row window, PRODUCT Context), so the
-- ADD COLUMN is instant and needs no UPDATE pass. Pure additive DDL: no new function, no
-- index (v1 writes/reads by pair PK; a partial "find pair by sidecar path" index is a
-- future flag, not v1), no REVOKE / no SET search_path (no PL/pgSQL added here).
--
-- NOT round-tripped (INV-9): the column is set on promotion but is not re-emitted back
-- into the sidecar on re-walk.

ALTER TABLE public.q_a_pairs
  ADD COLUMN source_document_id uuid;  -- nullable, FK-LESS (BUG-E / R1 precedent)

COMMENT ON COLUMN public.q_a_pairs.source_document_id IS
  'ID-59 {sidecar}: uuid5-derived (sd:<rel_path>) link to the Q&A sidecar source_documents '
  'row. FK-LESS -- cocoindex autocommit write model cannot satisfy cross-target FKs '
  '(migration 20260602073942 / BUG-E). NULL = no sidecar yet. NOT round-tripped (INV-9).';
