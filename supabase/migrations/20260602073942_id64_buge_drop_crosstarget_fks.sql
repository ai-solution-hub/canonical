-- ID-64.3 / BUG-E (S297) — drop the cross-target FK constraints the cocoindex
-- write model cannot satisfy.
--
-- ROOT CAUSE (verified against cocoindex 1.0.3 connectors/postgres/_target.py):
-- the USER-managed row-upsert path (_execute_upsert_chunk) writes each target on
-- its OWN pooled connection in AUTOCOMMIT (no shared transaction), parallelised
-- across targets via asyncio.TaskGroup. So a referencing row's INSERT
-- self-commits on one connection while the parent row's INSERT is a separate
-- autocommit transaction on another connection that may not have committed yet
-- -> the FK check fires at that statement's commit and violates. DEFERRABLE
-- INITIALLY DEFERRED does NOT help: deferral only defers the check to COMMIT
-- *within one transaction*, but these are separate autocommit transactions.
-- (The S297 migration 20260601211302 that made three of these deferrable + added
-- content_items.source_document_id was based on the wrong intra-flow-flush
-- hypothesis; this migration supersedes it.)
--
-- Referential integrity is preserved WITHOUT these FKs: every child FK value is a
-- DETERMINISTIC uuid5 seeded only on the parent's rel_path (the SAME seed the
-- parent's PK uses), so the reference equals the parent PK by construction on
-- every (idempotent UPSERT) run. The FK never established the relationship; it
-- only enforced a write ordering the cocoindex model cannot provide.
--
-- TRADE-OFF: the three ON DELETE CASCADE pairs (content_chunks, entity_mentions
-- -> content_items; form_template_fields -> form_templates) and the two ON
-- DELETE SET NULL pairs (content_items.source_document_id,
-- q_a_extractions.source_content_item_id) stop auto-firing on parent delete.
-- Accepted: the canonical layer is pipeline-written + re-ingested wholesale; any
-- wholesale wipe must delete children explicitly (no auto-cascade once dropped).

ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_source_document_id_fkey;

ALTER TABLE public.content_chunks
  DROP CONSTRAINT IF EXISTS content_chunks_content_item_id_fkey;

ALTER TABLE public.entity_mentions
  DROP CONSTRAINT IF EXISTS entity_mentions_content_item_id_fkey;

ALTER TABLE public.q_a_extractions
  DROP CONSTRAINT IF EXISTS q_a_extractions_source_content_item_id_fkey;

ALTER TABLE public.form_template_fields
  DROP CONSTRAINT IF EXISTS form_template_fields_template_id_fkey;
