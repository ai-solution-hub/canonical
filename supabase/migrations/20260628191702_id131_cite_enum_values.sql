-- ID-131.10 (G-CITE-WINRATE) — M4a: extend the cited_target_kind enum.
-- TECH.md §Migration set row M4a; PRODUCT.md BI-23 (CITE-EXT).
--
-- The citation contract is extended so a citation may target a reference_item,
-- a source_document, or a concept (in addition to the existing content_item and
-- q_a_pair labels). M4b adds the matching cited_*_id columns, rewrites the
-- exactly-one-of CHECK across all five kinds, and re-anchors the win-rate fns.
--
-- WHY A SEPARATE MIGRATION (separate txn) THAT MUST PRECEDE M4b:
-- PostgreSQL forbids USING a newly added enum value in the SAME transaction that
-- adds it ("unsafe use of new value of enum type", SQLSTATE 55P04). M4b's CHECK
-- constraint and any DML reference these new labels, so the ADD VALUEs must be
-- committed first, in their own transaction. This file therefore carries ONLY the
-- ALTER TYPE ... ADD VALUE statements and is ordered (timestamp 20260628191702)
-- strictly before M4b (20260628191703).
--
-- The existing labels are content_item, q_a_pair (squash baseline). The dead
-- content_item LABEL is intentionally NOT dropped here — PG cannot cheaply remove
-- an enum value, and the cited_content_item_id COLUMN drop is deferred to M6/G-API.

ALTER TYPE "public"."cited_target_kind" ADD VALUE IF NOT EXISTS 'reference_item';
ALTER TYPE "public"."cited_target_kind" ADD VALUE IF NOT EXISTS 'source_document';
ALTER TYPE "public"."cited_target_kind" ADD VALUE IF NOT EXISTS 'concept';
