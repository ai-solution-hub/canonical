-- bl-46 — widen ingestion_quality_log_flag_type_check for run_quality_scan().
--
-- `public.run_quality_scan()` (squash baseline 20260617130000, fn body ~L4868-4959)
-- INSERTs into ingestion_quality_log with two flag_type values that the live
-- CHECK constraint does NOT permit:
--   * 'classification_low' — missing-domain + very-low-confidence (<0.30) flags
--     (two INSERT branches).
--   * 'missing_content'     — empty/NULL content field flag (one INSERT branch).
-- Both are latent SQLSTATE 23514 (check_violation): the function has no callers
-- yet, so the violation has never fired — but the FIRST invocation against any DB
-- holding a NULL-domain (or empty-content) content_items row would abort the scan.
--
-- This forward migration rebuilds the CHECK to add BOTH values. The existing
-- seven values are preserved EXACTLY (duplicate, low_quality, missing_field,
-- review_needed, stale, conflicting, ssrf_rejected); the two run_quality_scan
-- values are appended. (bl-46 names classification_low; missing_content is the
-- same latent defect in the same function and is fixed in the same pass so the
-- scan does not 23514 on a different branch.)
--
-- Forward-only. NEVER edit the squash baseline (S408 fidelity lesson).
-- DROP IF EXISTS makes the rebuild idempotent / re-runnable.
ALTER TABLE public.ingestion_quality_log
  DROP CONSTRAINT IF EXISTS ingestion_quality_log_flag_type_check;

ALTER TABLE public.ingestion_quality_log
  ADD CONSTRAINT ingestion_quality_log_flag_type_check
  CHECK (("flag_type" = ANY (ARRAY[
    'duplicate'::"text",
    'low_quality'::"text",
    'missing_field'::"text",
    'review_needed'::"text",
    'stale'::"text",
    'conflicting'::"text",
    'ssrf_rejected'::"text",
    'classification_low'::"text",
    'missing_content'::"text"
  ])));
