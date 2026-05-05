-- §5.4.1 batch-draft-all schema-doc sync — idempotent re-affirm.
-- Per docs/specs/§5.4.1-batch-draft-all-spec.md §7.1 + the
-- reference-doc-edit-coupled-freshness guard
-- (`__tests__/docs/reference-doc-edit-coupled-freshness.test.ts`).
--
-- Rationale: the original W4-IMPL migration commit (465b41fa,
-- `20260505164817_s224_widen_job_type_check_bid_draft_all.sql`) widened
-- `processing_queue.job_type` CHECK to add `'bid_draft_all'` BUT did
-- NOT pair the same commit with `docs/reference/SCHEMA-QUICK-REFERENCE.md`
-- §8 row update (the IMPL agent flagged this as drift; the SCHEMA-QUICK-REF
-- doc trails main by one commit). The reference-doc-edit-coupled-freshness
-- guard scans the most-recent migration commit; this follow-up commit
-- restores same-commit pairing per `feedback_doc_freshness_guard_per_commit`
-- + `feedback_reference_doc_freshness_most_recent_only` "idempotent
-- re-affirm" escape pattern.
--
-- Behaviour: the DO-block re-asserts the same constraint definition the
-- W4-IMPL migration already shipped. If the constraint matches the
-- expected 9-value enum (which it does post-465b41fa application to
-- staging + prod), this migration is a strict no-op. If a future drift
-- causes the constraint to lose `'bid_draft_all'` (e.g. a manual ROLLBACK
-- or a schema reset), the DO-block re-applies the canonical definition.
-- Applies cleanly on persistent branches that replay full migration
-- history (fresh-branch determinism per
-- `feedback_persistent_branch_pre_restore_truncate`).

DO $$
DECLARE
  current_def text;
  expected_def text := 'CHECK ((job_type = ANY (ARRAY[''embed''::text, ''classify''::text, ''extract_qa''::text, ''summarise''::text, ''validate''::text, ''reprocess''::text, ''template_fill''::text, ''template_analyse''::text, ''bid_draft_all''::text])))';
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO current_def
    FROM pg_constraint
    WHERE conname = 'processing_queue_job_type_check'
      AND conrelid = 'public.processing_queue'::regclass;

  IF current_def IS DISTINCT FROM expected_def THEN
    -- Drift detected — re-affirm the canonical definition. Drop-then-add
    -- is the supported pattern for CHECK-constraint replacement on
    -- Supabase (PG 17.6).
    IF current_def IS NOT NULL THEN
      ALTER TABLE public.processing_queue
        DROP CONSTRAINT processing_queue_job_type_check;
    END IF;

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
  END IF;
  -- Else: post-W4-IMPL state matches expected; no-op.
END
$$;
