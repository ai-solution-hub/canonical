-- =============================================================================
-- ID-59 {59.14} — UC5 bid→Q&A promotion lineage columns
-- =============================================================================
--
-- Implements PRODUCT §A.7 (UC5) / TECH §PC-5 → INV-5(UC5).
--
-- Promoting a form response to a Q&A pair creates a `q_a_pairs` DRAFT carrying
-- lineage back to (a) the source form response and (b) its originating
-- question. NO file write; arbitration is NOT invoked. The user reviews the
-- draft (publication_status = 'draft') before publish.
--
-- These two columns are the net-new lineage surface. Both are NULLABLE and
-- additive — existing q_a_pairs rows (extracted/curated/imported) carry no
-- promotion lineage and stay valid. FK targets are the post-{64.14}
-- `form_*` tables (renamed from `bid_*` in
-- 20260609145550_id64_14_bid_to_form_rename.sql):
--   * source_form_response_id → public.form_responses(id)
--       (the source response promoted into the draft pair)
--   * source_question_id      → public.form_questions(id)
--       (the originating question the response answered;
--        form_responses.question_id already FKs form_questions(id),
--        but UC5 records the question lineage directly on q_a_pairs so the
--        draft is self-describing even if the response row is later deleted)
--
-- FK ON DELETE SET NULL mirrors the existing q_a_pairs lineage convention
-- (`superseded_by`, `source_workspace_id` — both NULL + ON DELETE SET NULL):
-- deleting a source form response/question must not cascade-delete a
-- human-reviewed Q&A draft; it only severs the lineage pointer.
--
-- Apply discipline (per supabase/CLAUDE.md):
--   * Staging first: supabase db push (orchestrator op post-cherry-pick)
--   * Liam ratification gate, then prod
--   * cat supabase/.temp/project-ref before each push (project-ref drift gotcha)
--   * supabase gen types typescript after apply (regenerates database.types.ts)
--
-- Idempotency: ADD COLUMN IF NOT EXISTS so a re-run is a no-op (repo convention).

ALTER TABLE public.q_a_pairs
  ADD COLUMN IF NOT EXISTS source_form_response_id uuid NULL
    REFERENCES public.form_responses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_question_id uuid NULL
    REFERENCES public.form_questions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.q_a_pairs.source_form_response_id IS
  'UC5 ({59.14}) promotion lineage: the form_responses(id) this Q&A draft was promoted from. NULL for non-promoted pairs. ON DELETE SET NULL.';

COMMENT ON COLUMN public.q_a_pairs.source_question_id IS
  'UC5 ({59.14}) promotion lineage: the form_questions(id) the source response answered. NULL for non-promoted pairs. ON DELETE SET NULL.';
