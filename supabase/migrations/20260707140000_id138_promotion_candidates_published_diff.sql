-- ID-138 {138.17} — promotion-candidates re-selection: published-pair re-walk
-- diffs must surface as proposals (DR-026 propose-surfacing half).
--
-- Context (re-grounded post-M6, {138.16} audit): the eligibility predicate
-- (originally squash_baseline.sql:4148-4161; re-pointed onto record_embeddings
-- by 20260706170000_id131_qa_fns_record_embeddings_repoint.sql) never
-- re-selects an extraction linked to a PUBLISHED pair (a pair whose
-- record_embeddings row already exists). A re-walk ({59.26}) can UPSERT the
-- same-PK extraction row with genuinely different carried text, but that diff
-- never re-enters the eligible set — it sits inert in q_a_extractions with no
-- surface at all (not even a proposal), because the RPC excludes it outright.
--
-- Fix (RPC-predicate-widen option, chosen over an admission-review UI surface
-- as the MINIMAL fix satisfying the testStrategy without new product-surface
-- decisions): ADD a third eligibility branch — a linked extraction whose pair
-- IS already embedded (published) is now ALSO re-selected, but ONLY when its
-- carried fields (question_text / answer_standard / alternate_question_
-- phrasings — exactly the set repromoteCarriedFields re-syncs, promote-
-- corpus.ts) genuinely differ from the linked pair's current values. A
-- re-walk that reproduces byte-identical carried text is NOT re-selected
-- (no diff, nothing to propose).
--
-- DR-026 (never auto-mutate a promoted/curated record) is enforced on the TS
-- side, NOT here: this migration only widens the SELECT-set (visibility).
-- lib/q-a-pairs/promote-corpus.ts (companion commit, same Subtask) reads the
-- linked pair's publication_status before acting — 'published' routes the
-- extraction into a NEW non-mutating `proposed` bucket (PromotionSummary.
-- proposed / .proposals) instead of the existing repromoteCarriedFields
-- auto-apply path, which remains reserved for still-draft (mid-promotion,
-- not yet curated) pairs. The RPC widen alone does NOT re-enable the
-- auto-mutate path for published pairs — the TS gate is the enforcement
-- point, this predicate is only the visibility half.
--
-- CREATE OR REPLACE only — NO signature/return-type change (still
-- RETURNS SETOF q_a_extractions; `SELECT e.*` unchanged), so per the
-- 20260706170000 precedent: api.q_a_extractions_promotion_candidates()
-- (thin `SELECT * FROM public.fn()` wrapper, squash_baseline.sql:962-966)
-- needs NO regen — same exact-arity overload resolves identically.
-- scripts/generate-api-views.ts SURFACE_RPCS['q_a_extractions_promotion_
-- candidates'] entry is unaffected — confirmed by inspection, no edit made.
--
-- Grants/search_path/SECURITY posture: re-asserted explicitly (not merely
-- relied upon via CREATE OR REPLACE's ACL-preserving behaviour) — REVOKE ALL
-- FROM PUBLIC, REVOKE EXECUTE FROM anon (DR-035 / {59.21} RLS-PATTERN P-4,
-- restored by 20260706180000_id131_revoke_anon_promotion_candidates.sql),
-- GRANT ALL TO authenticated + service_role. LANGUAGE sql STABLE unchanged
-- (no DECLARE support — the embedding-model literal stays inlined, matching
-- the 20260706170000 idiom).
--
-- AUTHORED, NOT APPLIED by this Subtask — no `supabase db push`, no MCP
-- `apply_migration`, no types regen. Owner-gated apply is a separate step;
-- return value is an apply-intent only (per {138.17} dispatch brief).
--
-- UK English throughout (DD/MM/YYYY). Authored 07/07/2026.
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
      -- Branch 1 (unchanged): never linked to a pair — brand-new candidate.
      e.promoted_to_pair_id IS NULL
      OR (
        -- Branch 2 (unchanged): linked, but the pair has no embedding yet
        -- (still draft / mid-promotion) — self-heal re-selection (OQ-3).
        p.id IS NOT NULL
        AND re_check.found IS NULL
      )
      OR (
        -- Branch 3 (NEW, {138.17}): linked to an ALREADY-EMBEDDED (published)
        -- pair, but a re-walk changed the carried text — re-select so the
        -- diff surfaces as a proposal (TS gate blocks auto-mutation; see
        -- header comment). Restricted to the exact carried-field set
        -- repromoteCarriedFields re-syncs.
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

COMMENT ON FUNCTION "public"."q_a_extractions_promotion_candidates"() IS 'ID-138.17 (DR-026 propose-surfacing half): widened to ALSO re-select an extraction linked to an already-published pair when its carried fields (question_text/answer_standard/alternate_question_phrasings) genuinely differ from the pair (re-walk diff). Visibility-only — the TS caller (promote-corpus.ts) gates the actual mutation on publication_status, never auto-applying onto a published pair. Return shape (SETOF q_a_extractions) and signature unchanged.';
