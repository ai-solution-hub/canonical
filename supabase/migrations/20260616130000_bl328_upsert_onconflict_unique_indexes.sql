-- =============================================================================
-- bl-328 — back the two `.upsert()` onConflict targets with UNIQUE indexes
-- =============================================================================
--
-- Surfaced by the ID-115 S1 spike (a PRE-EXISTING latent bug, NOT caused by api
-- isolation — PostgREST forwards ON CONFLICT to the base relation either way).
-- Two upsert call paths arbitrate on column sets that have NO backing unique
-- constraint, so the conflict (2nd-write) branch raises 42P10:
--
--   * read_marks   onConflict 'user_id,content_item_id'
--       app/api/read-marks/route.ts:108 (mark_read) + :142 (mark_bulk_read).
--       Reached on any re-mark of an already-read item; surfaced as HTTP 500.
--   * form_responses onConflict 'question_id'
--       responses/draft + draft-stream + queue/handlers/procurement-draft-all.
--       Reached on re-draft (draft-stream has no pre-existence check); surfaced
--       as failed/SSE-error.
--
-- Both unique constraints are SEMANTICALLY CORRECT:
--   * read_marks  — one read-mark per (user, item). RLS is per-user
--     (user_id = auth.uid()), so cross-user collisions are impossible anyway.
--   * form_responses — versioning is in-place: the bid_response_auto_version
--     trigger bumps `version` on UPDATE and snapshot_form_response_history
--     copies the OLD row into form_response_history. The live table is
--     one-row-per-question by design (idx_form_responses_question is
--     (question_id, version DESC), non-unique) — exactly what onConflict assumes.
--
-- A unique index makes the upsert's conflict branch resolve to an UPDATE (the
-- intended edit path), firing the version+history triggers as designed.
--
-- De-dup first (guarded; no-op on a clean DB — local has 0 dupes). Staging/prod
-- may carry dupes from the latent bug; the deterministic keep-one keeps the most
-- recent read (read_marks) / highest version (form_responses), id as tiebreaker.
-- Plain (non-CONCURRENT) CREATE UNIQUE INDEX — migrations run in a transaction
-- and both tables are small; the brief lock is acceptable.
-- =============================================================================

-- ── read_marks: one mark per (user_id, content_item_id) ─────────────────────
DELETE FROM public.read_marks a
USING public.read_marks b
WHERE a.user_id = b.user_id
  AND a.content_item_id = b.content_item_id
  AND (a.read_at, a.id) < (b.read_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_read_marks_user_item
  ON public.read_marks (user_id, content_item_id);

-- ── form_responses: one live row per question_id ────────────────────────────
DELETE FROM public.form_responses a
USING public.form_responses b
WHERE a.question_id = b.question_id
  AND (a.version, a.id) < (b.version, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_responses_question
  ON public.form_responses (question_id);
