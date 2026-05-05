-- §5.4.2 batch-reclassify migration: add 'batch_reclassify' to
-- processing_queue.job_type CHECK.
-- Per docs/specs/§5.4.2-batch-reclassify-spec.md §7.1 +
-- feedback_db_check_ts_union_paired_widening +
-- feedback_out_of_band_psql_must_become_migration (idempotent DO-block).

DO $$
BEGIN
  -- Only DROP if the constraint currently lacks 'batch_reclassify' — keeps
  -- the migration idempotent against fresh persistent-branch replays.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%batch_reclassify%'
  ) THEN
    ALTER TABLE public.processing_queue
      DROP CONSTRAINT processing_queue_job_type_check;
  END IF;

  -- Only ADD if the constraint isn't already present (was either dropped
  -- above OR was never there yet on this branch).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass
  ) THEN
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
        'batch_reclassify'::text
      ]));
  END IF;
END
$$;
