-- =============================================================================
-- ID-57 T10 WP1 — question_matches table (pre-cutover schema slice / {64.8} G6)
-- =============================================================================
-- Source of truth: docs/specs/id-57-question-matches-retrieval/{PRODUCT,TECH}.md §A.
-- Records ranked candidate q_a_pairs for a form-question (NOT the selected answer).
-- Separate per-method scores (N9 RESOLVED-S236); never a blended match_score column
-- (05-qa-flow.md §11 anti-pattern). RPC + population + bl-76 calibration ship POST-cutover.
-- The `vector`/scope columns live on q_a_pairs (RHS, corpus-level); this table stores
-- the scored edge only. Workspace relevance is a read-time scope-overlap filter, never a
-- stored FK on the RHS (A3/A8; 05-qa-flow.md §11).

CREATE TABLE public.question_matches (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A2: LHS = form-question instance (workspace-scoped; carries workspace_id).
  form_question_id  uuid        NOT NULL
                                REFERENCES public.form_questions(id) ON DELETE CASCADE,

  -- A3: RHS = corpus q_a_pair (corpus-level; no workspace FK).
  q_a_pair_id       uuid        NOT NULL
                                REFERENCES public.q_a_pairs(id) ON DELETE CASCADE,

  -- A4 / OQ-D: form-type discriminator as FK to form_types(key) (mirrors
  -- form_template_requirements.template_type precedent; extension via INSERT not ALTER).
  question_kind     text        NOT NULL
                                REFERENCES public.form_types(key) ON DELETE RESTRICT,

  -- A5 / OQ-A5-null: separate per-method scores, both nullable, >=1 present, each in [0,1].
  embedding_score   numeric(5,4),
  fulltext_score    numeric(5,4),

  -- A7: population-anticipating audit columns (no post-cutover ALTER required).
  matched_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A6: candidate-edge uniqueness — one corpus pair is never a duplicate candidate
  -- for the same form-question (question_kind is derivable from the form-question, so
  -- the two-column key suffices per PRODUCT A6 default assumption).
  CONSTRAINT question_matches_candidate_unique UNIQUE (form_question_id, q_a_pair_id),

  -- A5 / OQ-A5-null: no all-null-score row; each score bounded to cosine/ts_rank range.
  CONSTRAINT question_matches_score_present_chk
    CHECK (embedding_score IS NOT NULL OR fulltext_score IS NOT NULL),
  CONSTRAINT question_matches_embedding_score_range_chk
    CHECK (embedding_score IS NULL OR (embedding_score >= 0 AND embedding_score <= 1)),
  CONSTRAINT question_matches_fulltext_score_range_chk
    CHECK (fulltext_score IS NULL OR (fulltext_score >= 0 AND fulltext_score <= 1))
);

ALTER TABLE public.question_matches OWNER TO postgres;

-- A8: indexes for the two load-bearing access paths.
--  (i) retrieve all candidates for a form-question, ranked — FK col + score cols.
--      (The UNIQUE constraint A6 already provides a (form_question_id, q_a_pair_id) index;
--       this adds the ranking-friendly ordering on the per-method scores.)
CREATE INDEX idx_question_matches_form_question_ranked
  ON public.question_matches (form_question_id, embedding_score DESC, fulltext_score DESC);
--  (ii) reverse lookup: which form-questions cite a given corpus pair (recompute on
--       q_a_pair supersession — PRODUCT E3).
CREATE INDEX idx_question_matches_q_a_pair
  ON public.question_matches (q_a_pair_id);
-- NOTE A8: deliberately NO workspace-partition index on the RHS — q_a_pairs scope filtering
-- rides the existing idx_q_a_pairs_scope_tag GIN index (05-qa-flow.md §11 [DO-NOT-BUILD]).

-- A9: RLS + grants. The ensure_rls event trigger auto-enables RLS on CREATE TABLE; the
-- explicit ENABLE here is idempotent and self-documenting. grant_standard_public_table_access
-- applies the standard 3-role grants — including anon SELECT. We then explicitly REVOKE that
-- anon SELECT (belt-and-braces, matching the citations precedent's REVOKE-ALL-FROM-anon
-- posture): RLS already gates anon to zero rows via the policies below, but the explicit
-- REVOKE removes the table-level privilege entirely so anon cannot read question_matches at
-- all (B7/A9 — anon never reads). authenticated/service_role retain the helper's CRUD grants.
ALTER TABLE public.question_matches ENABLE ROW LEVEL SECURITY;
SELECT public.grant_standard_public_table_access('public.question_matches'::regclass);
REVOKE SELECT ON TABLE public.question_matches FROM anon;

-- Role matrix mirrors citations (ID-58): authenticated read; admin/editor write; admin delete.
-- (Workspace-membership scoping of candidate reads is enforced by the SECURITY DEFINER read
--  RPC in WP2 via form_questions.workspace_id — B7; direct-table SELECT is the coarse gate.)
CREATE POLICY question_matches_select_authenticated ON public.question_matches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY question_matches_insert_editor_admin ON public.question_matches
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = ANY (ARRAY['admin','editor']));
CREATE POLICY question_matches_update_editor_admin ON public.question_matches
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = ANY (ARRAY['admin','editor']));
CREATE POLICY question_matches_delete_admin ON public.question_matches
  FOR DELETE TO authenticated
  USING (public.get_user_role() = 'admin');

-- updated_at maintenance: reuse the standard touch trigger if one exists in the squash
-- baseline (set_updated_at / moddatetime); otherwise matched_at is the authoritative
-- last-scored stamp and updated_at tracks row mutation. (WP1 wires whichever the baseline
-- provides; no new trigger function is introduced by the schema slice.)

COMMENT ON TABLE public.question_matches IS
  'ID-57 T10 — ranked candidate edge between a form-question instance and a corpus q_a_pair. '
  'Separate per-method scores (N9 RESOLVED-S236); never a blended match_score. Candidacy, '
  'not selection (05-qa-flow.md §7.2). Distinct from citations (ID-58 provenance).';
