-- ID-131 {131.9} fix — source_documents.content_type DROP NOT NULL
-- content_type is a classification OUTPUT, unknown at ingest; a nullable column
-- surfaces the unclassified state (BI-27 surface-the-NULL) rather than a sentinel.
-- Sorts after M3 (191700/191701); clear of the not-yet-landed {131.10} migrations.
-- UK English. Authored 28/06/2026.
ALTER TABLE "public"."source_documents" ALTER COLUMN "content_type" DROP NOT NULL;
