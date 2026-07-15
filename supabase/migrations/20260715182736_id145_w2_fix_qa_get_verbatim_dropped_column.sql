-- ID-145 {145.23} round-2 — sibling tsc-INVISIBLE runtime defect to the
-- q_a_pairs_history_trigger fix in the preceding migration, same root cause:
-- W1c dropped q_a_pairs.source_workspace_id but public.q_a_get_verbatim()
-- (Two-step retrieval Step 2, squash baseline) still SELECTs qap.source_workspace_id
-- verbatim in a static RETURN QUERY. Unlike the trigger's deferred OLD.<col>
-- RECORD access, this is a literal SQL SELECT inside the function body --
-- empirically confirmed to hard-fail on every call:
--   ERROR: 42703: column qap.source_workspace_id does not exist
-- Zero live TypeScript callers found (grep across app/lib/components/hooks/
-- mcp-apps/scripts) -- only __tests__/integration/q-a-pairs/
-- two-step-retrieval.integration.test.ts exercises it directly, so this was
-- not user-facing, but it is a genuinely broken RPC left behind by W1c and
-- directly blocks that integration suite (145.23 round-2 file ownership).
--
-- api.q_a_get_verbatim is a thin `SELECT * FROM public.q_a_get_verbatim(...)`
-- wrapper (LANGUAGE sql) whose RETURNS TABLE must mirror the base function's
-- column list -- both are DROP+CREATE'd here (CREATE OR REPLACE cannot change
-- a table-returning function's OUT columns) with EXECUTE grants restored
-- exactly as they were (authenticated, service_role; no anon -- already
-- DR-035 born-locked, confirmed via pg_proc.proacl before this migration).
DROP FUNCTION IF EXISTS "api"."q_a_get_verbatim"("p_pair_id" "uuid");
DROP FUNCTION IF EXISTS "public"."q_a_get_verbatim"("p_pair_id" "uuid");

CREATE FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") RETURNS TABLE("id" "uuid", "question_text" "text", "alternate_question_phrasings" "text"[], "answer_standard" "text", "answer_advanced" "text", "scope_tag" "text"[], "anti_scope_tag" "text"[], "origin_kind" "text", "publication_status" "text", "superseded_by" "uuid", "valid_from" timestamp with time zone, "valid_to" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    qap.id,
    qap.question_text,
    qap.alternate_question_phrasings,
    qap.answer_standard,
    qap.answer_advanced,
    qap.scope_tag,
    qap.anti_scope_tag,
    qap.origin_kind,
    qap.publication_status,
    qap.superseded_by,
    qap.valid_from,
    qap.valid_to,
    qap.created_at,
    qap.updated_at
  -- question_embedding deliberately omitted (payload-size discipline per S16 §6.1)
  -- source_workspace_id DROPPED from q_a_pairs at W1c ({145.23} round-2 fix) --
  -- workspace lineage retired system-wide, no replacement column.
  FROM public.q_a_pairs qap
  WHERE qap.id = p_pair_id
  LIMIT 1;
END;
$$;

ALTER FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") IS 'T6 WP2 — PLAN.md §4.6 sub-task 4. Two-step retrieval Step 2: full q_a_pair row for a specific pair_id. question_embedding deliberately excluded (payload-size discipline per S16 §6.1). source_workspace_id DROPPED ({145.23} round-2 -- W1c removed the base column, workspace lineage retired system-wide). No publication_status filter — caller may fetch any lifecycle state including superseded/archived (lineage resolution).';

GRANT EXECUTE ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."q_a_get_verbatim"("p_pair_id" "uuid") TO "service_role";

CREATE FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") RETURNS TABLE("id" "uuid", "question_text" "text", "alternate_question_phrasings" "text"[], "answer_standard" "text", "answer_advanced" "text", "scope_tag" "text"[], "anti_scope_tag" "text"[], "origin_kind" "text", "publication_status" "text", "superseded_by" "uuid", "valid_from" timestamp with time zone, "valid_to" timestamp with time zone, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'extensions'
    AS $function$
  SELECT * FROM public.q_a_get_verbatim(p_pair_id => p_pair_id);
$function$;

GRANT EXECUTE ON FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") TO "authenticated";
GRANT EXECUTE ON FUNCTION "api"."q_a_get_verbatim"("p_pair_id" "uuid") TO "service_role";
