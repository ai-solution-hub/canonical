-- ID-131.19 S450 Wave 1 — get_dashboard_attention_counts REWRITE (Fix 1,
-- owner ruling verbatim intent, escalation 1 from the S449 Checker review of
-- the M6 drop migration's dependency audit — see
-- supabase/migrations-blocked/20260706110000_id131_drops.sql header, item 1).
--
-- AUTHORED, NOT APPLIED — owner-gated apply in the {131.19} GO sequence,
-- AFTER facet-mint (20260706100000) and BEFORE M6
-- (20260706110000_id131_drops.sql, which drops content_items + content_history
-- and is what makes the CURRENT function body error at its next call once
-- applied). No `supabase db push`, no MCP apply, no types regen in this
-- Subtask.
--
-- WHAT: the two remaining content_items-shaped OUT fields (of 9 total; the
-- other 7 are already record_lifecycle-based, safe) are disposed of
-- individually per the owner ruling:
--
--   - quality_flag_count: REWRITTEN onto the new model. The prior body
--     joined content_items ONLY to filter to "active" (non-archived)
--     records — every OTHER count in this same function already performs
--     that exact filter via `JOIN source_documents sd ... WHERE
--     sd.archived_at IS NULL` (governance/unverified/freshness/expiring
--     blocks). The quality-flag subquery below joins source_documents the
--     same way, dropping the content_items dependency entirely. This
--     mirrors the ALREADY-LIVE lib/reorient.ts quality-flags re-point
--     (ID-131 {131.19}, ingestion_quality_log distinct-source-document
--     count) and this function's own record_lifecycle join pattern.
--
--   - coverage_gap_count: RETIRED per DR-034 ("content_items-era coverage
--     feature RETIRED — retain template-completion coverage + governance
--     signals only"). No template-completion-shaped equivalent is trivially
--     logical for "active taxonomy_subtopics with zero live content" — the
--     concept (content-coverage-by-subtopic, keyed off content_items.
--     primary_subtopic) has no home post content_items retirement. Dropped
--     from the OUT signature entirely (not stubbed to 0 — an absent column
--     is honest; a fabricated 0 would silently lie to every consumer).
--     Downstream TS consumers updated in the SAME Subtask commit:
--     lib/attention.ts (AttentionSourceData.coverage_gap_count field +
--     produceCoverageGapItems producer removed, buildAttentionItems no
--     longer calls it), lib/dashboard.ts (UnifiedDashboardData.
--     attention_sources.coverage_gap_count extraction removed). app/page.tsx
--     and app/api/dashboard/route.ts need no change — the field is spread
--     structurally, never named there. app/coverage/**, components/
--     coverage/**, app/api/coverage/**, app/api/cron/coverage-alerts/**,
--     scripts/generate-api-views.ts are OUT OF SCOPE (parallel executor
--     lane, per this Subtask's file-ownership boundary) — this migration
--     does not touch get_coverage_matrix/get_coverage_summary or their
--     callers.
--
-- Postgres 42P13 forbids CREATE OR REPLACE across an OUT-column-set change
-- (dropping coverage_gap_count) — DROP FUNCTION + CREATE FUNCTION below, with
-- the SAME grants re-applied verbatim (checked against the LATEST public.*
-- grant statements for this function — 20260623130000_id70_opaque_json_rpc_
-- typed_returns.sql L315-317 — untouched by any later migration, including
-- the id115/id130 api-views regens which only re-touch the api.* wrapper).
--
-- api.get_dashboard_attention_counts is DELIBERATELY NOT touched by this
-- migration. Its own RETURNS TABLE still declares all 9 columns (incl.
-- coverage_gap_count) and its body is an unconditional `SELECT * FROM
-- public.get_dashboard_attention_counts(...)` passthrough
-- (20260625160000_id130_api_views_regen.sql L1676-1687, LANGUAGE sql). Once
-- THIS migration applies, calling the api.* wrapper WILL error ("structure
-- of query does not match function result type") until the api.*
-- whole-surface regen at this GO's M-API step rewrites it to match — an
-- accepted, temporary window per this GO's own sequencing (the M6 migration
-- documents the identical class of api.* wrapper deferral for its own drops).
-- The function STAYS in SURFACE_RPCS; scripts/generate-api-views.ts is NOT
-- this Subtask's file and is not edited here.
--
-- Idempotent / re-runnable: DROP FUNCTION IF EXISTS, then a plain CREATE
-- (not CREATE OR REPLACE, per the 42P13 constraint above) — safe to re-run
-- since the DROP always clears the prior definition first.

DROP FUNCTION IF EXISTS "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text");

CREATE FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text" DEFAULT 'viewer'::"text")
    RETURNS TABLE(
      "governance_review_count" integer,
      "unverified_count" integer,
      "quality_flag_count" integer,
      "stale_content_count" integer,
      "expired_content_count" integer,
      "expiring_content_date_count" integer,
      "unread_notification_count" integer,
      "freshness_summary" "jsonb"
    )
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_governance_review_count integer := 0;
  v_unverified_count integer;
  v_quality_flag_count integer := 0;
  v_stale_count integer;
  v_expired_count integer;
  v_fresh_count integer;
  v_aging_count integer;
  v_unread_notification_count integer;
  v_expiring_content_date_count integer;
BEGIN
  -- Governance review count (editors + admins only).
  IF p_role IN ('admin', 'editor') THEN
    SELECT COUNT(*) INTO v_governance_review_count
    FROM record_lifecycle rl
    JOIN source_documents sd ON sd.id = rl.source_document_id
    WHERE rl.owner_kind = 'source_document'
      AND sd.archived_at IS NULL
      AND rl.governance_review_status = 'pending';

    -- Quality flag count (editors + admins only). ID-131.19 S450 Wave 1
    -- Fix 1: re-pointed off content_items onto source_documents — same
    -- "active record" join pattern every other count in this function
    -- already uses (content_items drops wholesale at M6).
    SELECT COUNT(DISTINCT iql.source_document_id) INTO v_quality_flag_count
    FROM ingestion_quality_log iql
    JOIN source_documents sd ON iql.source_document_id = sd.id
    WHERE iql.resolved = FALSE
      AND iql.source_document_id IS NOT NULL
      AND sd.archived_at IS NULL;
  END IF;

  -- Unverified count.
  SELECT COUNT(*) INTO v_unverified_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.verified_at IS NULL;

  -- Freshness breakdown (single scan).
  SELECT
    COUNT(*) FILTER (WHERE rl.freshness = 'fresh'),
    COUNT(*) FILTER (WHERE rl.freshness = 'aging'),
    COUNT(*) FILTER (WHERE rl.freshness = 'stale'),
    COUNT(*) FILTER (WHERE rl.freshness = 'expired')
  INTO v_fresh_count, v_aging_count, v_stale_count, v_expired_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.freshness IS NOT NULL;

  -- Unread notifications. UNCHANGED — unrelated to content_items/record_lifecycle.
  SELECT COUNT(*) INTO v_unread_notification_count
  FROM notifications
  WHERE user_id = p_user_id
    AND dismissed_at IS NULL
    AND read_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW());

  -- Expiring content dates (within 30 days).
  SELECT COUNT(*) INTO v_expiring_content_date_count
  FROM record_lifecycle rl
  JOIN source_documents sd ON sd.id = rl.source_document_id
  WHERE rl.owner_kind = 'source_document'
    AND sd.archived_at IS NULL
    AND rl.expiry_date IS NOT NULL
    AND rl.expiry_date <= NOW() + INTERVAL '30 days';

  -- ID-131.19 S450 Wave 1 Fix 1: coverage_gap_count RETIRED per DR-034 (no
  -- template-completion-shaped equivalent) — no computation, no OUT column,
  -- no RETURN QUERY tuple slot below.

  RETURN QUERY SELECT
    v_governance_review_count,
    v_unverified_count,
    v_quality_flag_count,
    v_stale_count,
    v_expired_count,
    v_expiring_content_date_count,
    v_unread_notification_count,
    jsonb_build_object(
      'fresh', v_fresh_count,
      'aging', v_aging_count,
      'stale', v_stale_count,
      'expired', v_expired_count
    );
END;
$$;

ALTER FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") IS 'ID-131.19 S450 Wave 1 Fix 1: quality_flag_count re-pointed off content_items onto source_documents (same active-record join every other count here uses); coverage_gap_count RETIRED per DR-034 (content_items-era coverage feature retired, no template-completion-shaped equivalent) and dropped from the OUT signature entirely. RETURNS TABLE now has 8 columns (was 9) — api.get_dashboard_attention_counts is intentionally left stale pending this GO''s M-API whole-surface regen (see migration header). Caller lib/dashboard.ts reads data[0].<column> by name and no longer reads coverage_gap_count.';

REVOKE ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_attention_counts"("p_user_id" "uuid", "p_role" "text") TO "service_role";
