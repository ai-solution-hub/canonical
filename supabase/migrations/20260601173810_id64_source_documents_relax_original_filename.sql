-- ID-64.11 (S296) — relax source_documents.original_filename NOT NULL.
--
-- Decision-graph Q1.9 Option α (slim-and-keep) RETIRES original_filename: the
-- canonical cocoindex pipeline derives + writes filename / mime_type / file_size
-- from the File (basename / suffix-resolved mime / byte size) but intentionally
-- does NOT thread an original_filename through the flow. The column is kept (no
-- DROP) for historical/manual rows; it just becomes nullable so the pipeline's
-- source_documents write satisfies the table without inventing a value.
--
-- Pre-re-ingest readiness gate A (write-path), companion to the flow.py write in
-- scripts/cocoindex_pipeline/flow.py (sd_target.declare_row). Authoritative input:
-- docs/themes/canonical-pipeline/reference/pipeline-writepath-schema-gap-s295.md
-- (§S296 RATIFIED DECISIONS). 0-row-safe on prod (the canonical pipeline has
-- never completed a content-write); no backfill required.

ALTER TABLE public.source_documents
    ALTER COLUMN original_filename DROP NOT NULL;
