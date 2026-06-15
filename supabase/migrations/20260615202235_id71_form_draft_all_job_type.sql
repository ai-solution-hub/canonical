-- ID-71 bid→form rename: add 'form_draft_all' to processing_queue.job_type
-- CHECK (formerly 'bid_draft_all'; the TS JobType union in lib/queue/envelope.ts
-- is renamed in lockstep — per feedback_db_check_ts_union_paired_widening).
--
-- Clean break: no live 'bid_draft_all' consumers per the {71.6} Wave-0 inventory.
-- We ADD 'form_draft_all' while transiently RETAINING 'bid_draft_all' in the
-- CHECK — a superset CHECK is harmless (the producer-side union is a strict
-- subset; the reverse mismatch is what breaks). Retaining the legacy value
-- guards any in-flight row during the deferred-apply window; it drains naturally
-- because the renamed union no longer enqueues 'bid_draft_all'. A later
-- CHECK-narrowing migration may drop it once zero extant rows is proven.
--
-- CHECK-only: no new PL/pgSQL function, no REVOKE needed (per supabase/CLAUDE.md
-- + TECH.md §OQ-4 M31/M41). Per feedback_out_of_band_psql_must_become_migration:
-- idempotent DO-block guard so fresh persistent-branch replays are deterministic.

DO $$
BEGIN
  -- Only DROP if the constraint currently lacks 'form_draft_all' — keeps the
  -- migration idempotent against fresh persistent-branch replays.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%form_draft_all%'
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
        'form_draft_all'::text,
        'batch_reclassify'::text
      ]));
  END IF;
END
$$;
