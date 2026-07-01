-- ID-131 {131.8} G-PIPELINE — M2 orphan-RPC repoint
-- Companion to 20260628200000_id131_extract_reparent.sql (M2), which renamed
-- public.entity_relationships.source_item_id -> source_document_id.
--
-- get_entity_relationships_rpc() was ORPHANED by that rename: its PL/pgSQL body
-- reads er.source_item_id and its RETURNS TABLE declares source_item_id uuid.
-- PostgreSQL defers function-body column validation to execution time, so
-- `supabase db reset` / pytest / typecheck all stayed green while ANY live call
-- threw `column er.source_item_id does not exist`. The MCP get_entity_relationships
-- tool (lib/mcp/tools/entities.ts) calls this RPC behind a `if (!relError && relRows)`
-- guard that SILENTLY swallowed the error, returning empty relationships. No later
-- subtask re-points it, so it would stay broken forever. This migration re-points
-- the orphaned body + return signature to source_document_id (definition otherwise
-- copied verbatim from the squash_baseline def — LANGUAGE, search_path, OWNER,
-- COMMENT, and ACL preserved).
--
-- DROP-then-CREATE (not CREATE OR REPLACE): renaming a RETURNS TABLE column is a
-- return-type change, which CREATE OR REPLACE rejects with SQLSTATE 42P13
-- ("cannot change return type of existing function — Row type defined by OUT
-- parameters is different"). The function is orphaned with a single MCP caller via
-- .rpc(), so the brief DROP is safe.

DROP FUNCTION IF EXISTS "public"."get_entity_relationships_rpc"("p_entity_name" "text");

CREATE OR REPLACE FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") RETURNS TABLE("source_entity" "text", "relationship_type" "text", "target_entity" "text", "source_document_id" "uuid", "confidence" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    er.source_entity,
    er.relationship_type,
    er.target_entity,
    er.source_document_id,
    er.confidence
  FROM entity_relationships er
  WHERE er.source_entity ILIKE '%' || p_entity_name || '%'
     OR er.target_entity ILIKE '%' || p_entity_name || '%'
  ORDER BY er.confidence DESC, er.created_at DESC;
END;
$$;

ALTER FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") IS 'Query entity relationships by entity name (matches both source and target)';

REVOKE ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_entity_relationships_rpc"("p_entity_name" "text") TO "service_role";
