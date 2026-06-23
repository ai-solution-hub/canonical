-- ID-117.13 — DROP the retired source_document_diffs engine.
--
-- ID-117 replaces the legacy Q&A-pair diff-review workflow with the unified diff
-- surface (UnifiedRevision/UnifiedDiff + the rebuilt /documents/[id]/diff binary
-- depth). The source_document_diffs table backed the retired review workflow only.
--
-- Liveness: 0 rows on the Platform DB (canonical-platform, currently both prod &
-- staging) — verified before apply (ID-117.13). All code couplings were retired
-- in {117.12}; the re-ingest notification path was REHOMED off this table in
-- {117.11} (analyseDocumentImpact now takes in-memory DiffEntry[]).
--
-- View-before-table: drop the api Data API view first, then the base table.
-- CASCADE is a no-op safety net here (0 inbound FKs, 0 triggers, 0 dependent
-- functions; only the api view depended on the table, and it is dropped above).

DROP VIEW IF EXISTS "api"."source_document_diffs";

DROP TABLE IF EXISTS "public"."source_document_diffs" CASCADE;
