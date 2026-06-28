-- ID-131 M0c (BI-1, BI-14): pre-M2 debris-wipe of disposable E2E debris on the live head.
-- These content_items-anchored rows (0 resolve to source_documents) would make M2's
-- (ID-131 {131.8}) ADD FK -> source_documents hard-fail. NOT a data migration: nothing is
-- copied; the full-replace re-ingest (BI-2) rebuilds knowledge on a fresh preview branch.
DELETE FROM entity_mentions;
DELETE FROM entity_relationships;
DELETE FROM content_history;
DELETE FROM content_items;
