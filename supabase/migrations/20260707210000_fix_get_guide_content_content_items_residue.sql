-- ============================================================================
-- LIVE PRODUCTION BUG FIX (both envs) — public.get_guide_content still LEFT
-- JOINs the M6-dropped `content_items` table in its SQL body. Postgres does
-- not dependency-track a `LANGUAGE sql` function body against the tables it
-- queries the way it does a view, so 20260706110000_id131_drops.sql's
-- `DROP TABLE content_items` succeeded silently — this function only fails
-- at CALL time ("relation \"content_items\" does not exist"), reproduced
-- live on staging: `SELECT * FROM public.get_guide_content('ci-test-guide')`.
-- Live caller: app/api/guides/[slug]/route.ts:64 (`supabase.rpc(
-- 'get_guide_content', ...)`), consumed by the live `/guide/[slug]` page
-- (app/guide/[slug]/guide-content.tsx) — every guide view 500s today.
--
-- WHY THIS ESCAPED THE M6 AUDIT: 20260706110000_id131_drops.sql's own header
-- names exactly THREE escaped live functions (get_dashboard_attention_counts,
-- get_coverage_matrix, get_coverage_summary) found by grepping every
-- content_items/content_history reference across migrations cross-checked
-- against live TS callers. get_guide_coverage() was found SEPARATELY the
-- same GO (20260706104000_id131_coverage_retire.sql, "ESCALATION 2") — a
-- structurally identical LEFT JOIN content_items keyed on guide_sections'
-- domain/subtopic/layer/content_type filters, but scoped to aggregate
-- counts (content_count/fresh_count/stale_count). get_guide_content — the
-- SAME guide_sections-driven matching logic, but returning per-item rows
-- instead of aggregates — was never named in either audit. It is a fifth
-- escapee, discovered post-GO by a fix-Executor dispatch.
--
-- DISPOSITION — grep across every current schema table confirms the
-- content-matching axis get_guide_content depended on cannot be re-pointed:
--   * domain/subtopic/content_type classification DID move to
--     source_documents (20260628191700_id131_sd_classification_cols.sql:
--     primary_domain/primary_subtopic/secondary_domain/secondary_subtopic/
--     content_type/publication_status/captured_date, mirroring content_items
--     1:1) and freshness/verified_at moved to record_lifecycle
--     (owner_kind='source_document').
--   * BUT the `layer` axis (content_items.layer, matched against
--     guide_sections.expected_layer — e.g. 'sales_brief'/'bid_detail'/
--     'company_reference'/'research', see public.layer_vocabulary) has NO
--     successor column on source_documents, q_a_pairs, or reference_items.
--     Verified live: `\d source_documents` / `\d q_a_pairs` /
--     `\d reference_items` on staging (rbwqewalexrzgxtvcqrh) — none carries
--     a per-row layer assignment. This axis was structurally eliminated at
--     M6, not merely relocated — there is nothing to re-point onto without
--     inventing a new per-document layer-assignment data model (a product/
--     schema decision, out of this fix's authority).
--   * This mirrors DR-034's binding owner ruling (coverage_retire.sql,
--     "the content_items-era coverage feature ... is RETIRED, not
--     re-pointed") and escalation 2b's identical treatment of the sibling
--     get_guide_coverage() (same guide_sections + content_items JOIN
--     shape) — both retired the content-matching axis rather than
--     fabricating a re-point.
--
-- FIX (option (b) per this Subtask's dispatch brief — "if the
-- content_items-derived fields are structurally gone (nothing to re-point
-- onto), strip them from the fn"): drop the `LEFT JOIN content_items`
-- entirely; return guide_sections rows (grouped/ordered exactly as before)
-- with every content_* column explicitly NULL. RETURNS TABLE signature is
-- BYTE-IDENTICAL to the squash baseline (14 columns, same names/types) —
-- zero changes needed to app/api/guides/[slug]/route.ts or any guide-*.tsx
-- consumer:
--   * route.ts:100-126 already treats `row.content_id` as possibly-NULL
--     ("Only add content items if there is one (LEFT JOIN may produce
--     NULLs)") — this was ALREADY the no-match code path, now taken
--     unconditionally.
--   * components/guide/guide-section.tsx already renders a first-class
--     empty state (GuideSectionEmpty, "No content yet" + a create-content
--     CTA) whenever `section.content_items.length === 0` — not a new UI
--     state, just now the only one reachable.
-- Net effect: guide pages load again (sections, progress bar, table of
-- contents, research-feed section all render), but every section shows the
-- empty state until a follow-up product/schema decision restores per-item
-- layer-tagged content matching (or the /guide feature is retired to match
-- get_guide_coverage's precedent) — flagged to the Curator, not decided
-- here.
--
-- CREATE OR REPLACE only — NO signature/return-type change, so
-- api.get_guide_content (thin `SELECT * FROM public.get_guide_content(
-- p_guide_slug => p_guide_slug)` wrapper, squash_baseline.sql:682-690)
-- needs NO regen — same exact-arity overload resolves identically.
-- scripts/generate-api-views.ts SURFACE_RPCS['get_guide_content'] entry is
-- unaffected — confirmed by inspection, no edit made.
--
-- Grants/search_path/SECURITY posture: re-asserted explicitly (DR-035 —
-- CREATE OR REPLACE preserves the ACL of an existing function object, but
-- staging's grant posture is re-affirmed defensively rather than relied
-- upon implicitly, mirroring the 20260706170000/20260707140000 precedent).
-- Live posture verified via has_function_privilege before this migration:
-- anon EXECUTE already false, authenticated/service_role already true — no
-- anon-EXECUTE regression to close here (unlike promotion_candidates'
-- 20260706180000 fix), so no separate `REVOKE EXECUTE ... FROM anon` line
-- is added; REVOKE ALL FROM PUBLIC already covers anon since no anon-
-- specific GRANT was ever issued for this function. LANGUAGE sql STABLE
-- unchanged.
--
-- UK English throughout (DD/MM/YYYY). Authored 07/07/2026.
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."get_guide_content"("p_guide_slug" "text") RETURNS TABLE("section_id" "uuid", "section_name" "text", "section_description" "text", "section_order" integer, "expected_layer" "text", "subtopic_filter" "text", "is_required" boolean, "content_id" "uuid", "content_title" "text", "content_type" "text", "content_layer" "text", "content_brief" "text", "content_freshness" "text", "content_verified_at" timestamp with time zone, "content_captured_date" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  SELECT
    gs.id AS section_id,
    gs.section_name,
    gs.description AS section_description,
    gs.display_order AS section_order,
    gs.expected_layer,
    gs.subtopic_filter,
    gs.is_required,
    -- content_items (the sole source of per-item content matching) was
    -- dropped at M6 (20260706110000_id131_drops.sql) with no successor
    -- carrying a per-row `layer` assignment — see header. Every content_*
    -- column is explicitly NULL until a product/schema decision restores
    -- (or formally retires) guide content matching.
    NULL::"uuid" AS content_id,
    NULL::"text" AS content_title,
    NULL::"text" AS content_type,
    NULL::"text" AS content_layer,
    NULL::"text" AS content_brief,
    NULL::"text" AS content_freshness,
    NULL::timestamp with time zone AS content_verified_at,
    NULL::timestamp with time zone AS content_captured_date
  FROM guide_sections gs
  JOIN guides g ON g.id = gs.guide_id
  WHERE g.slug = p_guide_slug
  ORDER BY gs.display_order;
$$;

ALTER FUNCTION "public"."get_guide_content"("p_guide_slug" "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") TO "service_role";

COMMENT ON FUNCTION "public"."get_guide_content"("p_guide_slug" "text") IS 'Fix-Executor (live P0, post-131.19 M6): the content_items LEFT JOIN escaped the M6 drop audit (relation did not exist -> every call errored). Stripped per DR-034''s precedent (get_guide_coverage''s identical guide-content-matching axis was ruled RETIRE, not re-pointed -- no surviving table carries a per-row layer assignment). Return shape (14-column TABLE) and signature unchanged; every content_* column is now NULL -- section_id/section_name/section_description/section_order/expected_layer/subtopic_filter/is_required are unaffected. Restoring per-item content matching (or formally retiring /guide) is an open product/schema decision, routed to the Curator.';
