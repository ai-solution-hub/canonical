-- id-398 (F4, id-396 TECH §4 D1): engine-path em:/er: PKs are re-seeded on the
-- stored source_document_id (flow.py) so byte-identical re-stagings
-- upsert-absorb via ON CONFLICT (id) instead of re-declaring the same
-- natural-key unique tuples under fresh rel_path-seeded ids (census #40: 423
-- UniqueViolationErrors, nightly hard-down).
--
-- Data half: every existing entity_mentions / entity_relationships row was
-- minted by the pre-fix engine path with a rel_path-seeded PK — the
-- ingest_once path (registry-keyed from day one) has no live caller yet
-- (id-45). Stage-5 may have rewritten canonical_name on em rows, so the
-- original seed input is not reliably recomputable; per the DR-093 pre-launch
-- posture (delete, don't backfill) the legacy rows are deleted outright and
-- the next walk re-mints all derived rows under the fixed registry-keyed PKs.
-- No FK references either table (verified against Platform staging + prod at
-- authoring); Platform prod held 0 rows in both tables — this is a
-- staging-only cleanup in practice. DML only, no api-surface change (DR-032
-- companion regen not required).

DELETE FROM public.entity_relationships;

DELETE FROM public.entity_mentions;
