-- §5.4.1 batch-draft-all migration: add 'bid_draft_all' to processing_queue.job_type CHECK.
-- Per docs/specs/§5.4.1-batch-draft-all-spec.md §7.1 + feedback_db_check_ts_union_paired_widening.
-- Per feedback_out_of_band_psql_must_become_migration: idempotent DO-block guard so fresh
-- branches replay deterministically.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass
  ) THEN
    ALTER TABLE public.processing_queue
      DROP CONSTRAINT processing_queue_job_type_check;
  END IF;
END
$$;

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
    'bid_draft_all'::text
  ]));
