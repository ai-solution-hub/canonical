-- ID-71 follow-up — restore 'markdown_batch' to processing_queue.job_type CHECK.
--
-- PROVENANCE: 20260615202235_id71_form_draft_all_job_type.sql was reconciled to
-- prod (rovrym) by the parallel canonical-pipeline session in an EARLIER form
-- whose CHECK array REPLACED rather than supersetted — it dropped the
-- retired-but-RETAINED 'markdown_batch' value. The §5.4.4 upload-markdown-batch
-- producer path is retired (ID-56.12 superseded the manual markdown-upload flow;
-- dropped from the TS JobType union), but the DB CHECK DELIBERATELY keeps the
-- value as a superset of extant data (270+ historical rows on staging) — see
-- lib/queue/envelope.ts design note. prod's processing_queue is empty, so the
-- narrower constraint applied silently there, leaving prod's CHECK missing
-- 'markdown_batch' while staging (corrected 202235) retained it.
--
-- This forward-only migration restores cross-env parity: it widens the
-- constraint to the canonical 12-value superset on any env still missing
-- 'markdown_batch'. Idempotent + DDL-via-CLI (supabase/CLAUDE.md): it no-ops
-- where 202235 already produced the correct constraint (staging, platform, and
-- any fresh persistent-branch replay of the corrected 202235).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%markdown_batch%'
  ) THEN
    ALTER TABLE public.processing_queue
      DROP CONSTRAINT processing_queue_job_type_check;

    ALTER TABLE public.processing_queue
      ADD CONSTRAINT processing_queue_job_type_check
      CHECK (job_type = ANY (ARRAY[
        'embed'::text,
        'classify'::text,
        'extract_qa'::text,
        'summarise'::text,
        'validate'::text,
        'reprocess'::text,
        'template_fill'::text,
        'template_analyse'::text,
        'bid_draft_all'::text,
        'form_draft_all'::text,
        'batch_reclassify'::text,
        'markdown_batch'::text
      ]));
  END IF;
END
$$;
