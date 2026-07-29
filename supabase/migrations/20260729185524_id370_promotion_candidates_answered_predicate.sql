-- id-370 — route walk-discovered unanswered questions off the promotion
-- funnel (S511 board D6, owner-ratified Option 1 + DR-014 confirmed in force).
--
-- Context (RESEARCH.md, specs/id-370-unanswered-question-routing): a blank
-- form's questions extract — CORRECTLY — to q_a_extractions rows with a NULL
-- extracted_answer_text (null is a sanctioned extraction result end-to-end:
-- prompts.py "OR null"; QAPair.answer_text: str | None). But q_a_extractions
-- feeds the answered-pairs-only promotion funnel, and branch 1 of
-- q_a_extractions_promotion_candidates() admitted those rows with NO answer
-- predicate — while branch 3 (the {138.17} published-diff branch) ALREADY
-- carries exactly the needed predicate (`extracted_answer_text IS NOT NULL
-- AND trim(...) <> ''`). The defect is an asymmetry; this migration is the
-- one-line symmetry restoration. The flow.py companion (same PR) gates the
-- declare so unanswered pairs no longer mint rows at all — this predicate is
-- the defence-in-depth second layer.
--
-- CREATE OR REPLACE only — NO signature/return-type change (still
-- RETURNS SETOF q_a_extractions; `SELECT e.*` unchanged), so per the
-- 20260706170000 / 20260707140000 precedent the api wrapper
-- api.q_a_extractions_promotion_candidates() needs NO regen — same
-- exact-arity overload resolves identically (DR-032 satisfied with no
-- companion exposure change).
--
-- Body copied VERBATIM from 20260707140000_id138_promotion_candidates_
-- published_diff.sql (the live body) with ONLY branch 1 changed. search_path
-- kept verbatim ('public', 'extensions' — supabase/CLAUDE.md: never add
-- `api`; exposure is the boundary, search_path is the plumbing).
--
-- Grants/search_path/SECURITY posture: re-asserted explicitly (REVOKE ALL
-- FROM PUBLIC, REVOKE EXECUTE FROM anon — DR-035; GRANT ALL TO authenticated
-- + service_role), matching the 20260707140000 idiom. LANGUAGE sql STABLE
-- unchanged.
--
-- The trailing DELETE is the owner-ratified DR-093 data posture (S494 ruling:
-- platform not live, all Platform staging + prod data synthetic — no
-- backfill, delete freely): the ~135 class-A rows (unanswered questions from
-- blank forms) are permanently unpromotable with no authoring path out, and
-- are removed rather than migrated. Structure is the deliverable.
--
-- AUTHORED, NOT APPLIED by this worker — no `supabase db push`, no MCP
-- apply_migration; CI/deploy applies it (per the id-370 dispatch brief).
--
-- UK English throughout (DD/MM/YYYY). Authored 29/07/2026.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."q_a_extractions_promotion_candidates"() RETURNS SETOF "public"."q_a_extractions"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT e.*
  FROM public.q_a_extractions e
  LEFT JOIN public.q_a_pairs p ON p.id = e.promoted_to_pair_id
  LEFT JOIN LATERAL (
    SELECT 1 AS found
    FROM public.record_embeddings re
    WHERE re.owner_kind = 'q_a_pair'
      AND re.owner_id = p.id
      AND re.model = 'text-embedding-3-large'
    LIMIT 1
  ) re_check ON TRUE
  WHERE e.invalidated_at IS NULL
    AND (
      -- Branch 1 (id-370: answered predicate added — symmetry with branch 3):
      -- never linked to a pair — brand-new candidate — AND actually answered.
      -- An unanswered extraction (blank-form question) is never a promotion
      -- candidate: the funnel only mints pairs from answered extractions.
      (
        e.promoted_to_pair_id IS NULL
        AND e.extracted_answer_text IS NOT NULL
        AND trim(e.extracted_answer_text) <> ''
      )
      OR (
        -- Branch 2 (unchanged): linked, but the pair has no embedding yet
        -- (still draft / mid-promotion) — self-heal re-selection (OQ-3).
        p.id IS NOT NULL
        AND re_check.found IS NULL
      )
      OR (
        -- Branch 3 (unchanged, {138.17}): linked to an ALREADY-EMBEDDED
        -- (published) pair, but a re-walk changed the carried text —
        -- re-select so the diff surfaces as a proposal (TS gate blocks
        -- auto-mutation; see 20260707140000 header comment). Restricted to
        -- the exact carried-field set repromoteCarriedFields re-syncs.
        p.id IS NOT NULL
        AND re_check.found IS NOT NULL
        AND (
          e.extracted_question_text IS DISTINCT FROM p.question_text
          OR (
            e.extracted_answer_text IS NOT NULL
            AND trim(e.extracted_answer_text) <> ''
            AND e.extracted_answer_text IS DISTINCT FROM p.answer_standard
          )
          OR COALESCE(e.alternate_question_phrasings, '{}'::text[])
             IS DISTINCT FROM COALESCE(p.alternate_question_phrasings, '{}'::text[])
        )
      )
    )
  ORDER BY e.created_at;
$$;

ALTER FUNCTION "public"."q_a_extractions_promotion_candidates"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."q_a_extractions_promotion_candidates"() FROM "anon";
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."q_a_extractions_promotion_candidates"() TO "service_role";

COMMENT ON FUNCTION "public"."q_a_extractions_promotion_candidates"() IS 'ID-138.17 (DR-026 propose-surfacing half) + id-370 (S511 D6): branch 1 now requires a non-empty extracted_answer_text (symmetry with branch 3) — an unanswered extraction is never a promotion candidate. Still ALSO re-selects an extraction linked to an already-published pair when its carried fields (question_text/answer_standard/alternate_question_phrasings) genuinely differ from the pair (re-walk diff); visibility-only — the TS caller (promote-corpus.ts) gates the actual mutation on publication_status. Return shape (SETOF q_a_extractions) and signature unchanged.';

-- ── id-370 data delete (DR-093 posture, owner-ratified S494/S511) ───────────
-- Remove the class-A rows (unanswered questions minted by walks of blank
-- forms under the pre-gate routing). Permanently unpromotable — no authoring
-- path can supply an answer (accept/edit routes 409 on unlinked rows; the
-- walk can never re-extract an answer that is not in the source document).
-- All data on Platform staging AND prod is synthetic (owner ruling S494) —
-- delete, do not migrate. The flow.py gate + the branch-1 predicate above
-- prevent the class from re-accumulating.
DELETE FROM public.q_a_extractions
WHERE extracted_answer_text IS NULL
   OR trim(extracted_answer_text) = '';
