-- ID-131 {131.9} G-SD-COLS M3-trig — record_lifecycle.domain write-time sync
-- TECH.md §"Migration set" row M3-trig (id131_record_lifecycle_domain_sync);
-- TECH §"record_lifecycle.domain write-time sync" (lines 372-379); PRODUCT BI-21.
--
-- Keeps the facet's denormalised domain equal to the owner record's domain so the
-- one-hop policy join into governance_config (UNIQUE(domain), unchanged — BI-21)
-- keeps working for the freshness / review / quality crons and supplies the
-- win-rate aggregate scope (M4b).
--
--   * source_document owner -> source_documents.primary_domain (M3 col).
--   * q_a_pair owner -> resolve via the q_a_pair's source_document_id's
--     primary_domain when present, ELSE 'unclassified' (Finding 2 — q_a_pairs
--     carries no domain; 2 of 4 origin_kinds are sourceless).
--
-- Created HERE, NOT in M1a (id131_record_lifecycle_facet), because it dereferences
-- source_documents.primary_domain, which only exists after M3 (migration 1). This
-- migration MUST sort strictly after id131_sd_classification_cols.
--
-- New PL/pgSQL discipline: SET search_path inside the function; REVOKE EXECUTE
-- FROM anon. UK English. Authored 28/06/2026.

CREATE OR REPLACE FUNCTION "public"."record_lifecycle_domain_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_domain text;
BEGIN
  IF NEW.owner_kind = 'source_document' THEN
    -- Direct read of the owning source_document's domain (M3 col, NOT NULL).
    SELECT sd.primary_domain INTO v_domain
    FROM public.source_documents sd
    WHERE sd.id = NEW.source_document_id;
    NEW.domain := COALESCE(v_domain, 'unclassified');
  ELSIF NEW.owner_kind = 'q_a_pair' THEN
    -- q_a_pairs carry no domain (Finding 2). Resolve via the pair's optional
    -- source_document_id provenance; sourceless pairs sync to 'unclassified'.
    SELECT sd.primary_domain INTO v_domain
    FROM public.q_a_pairs qap
    LEFT JOIN public.source_documents sd ON sd.id = qap.source_document_id
    WHERE qap.id = NEW.q_a_pair_id;
    NEW.domain := COALESCE(v_domain, 'unclassified');
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."record_lifecycle_domain_sync"() OWNER TO "postgres";

COMMENT ON FUNCTION "public"."record_lifecycle_domain_sync"() IS 'ID-131 {131.9} M3-trig, BI-21: write-time sync keeping record_lifecycle.domain = owner domain (source_document -> primary_domain; q_a_pair -> its source_document_id primary_domain else ''unclassified''). Preserves the one-hop governance_config policy join.';

-- Trigger function: not user-callable; deny anon EXECUTE (runs via the trigger).
REVOKE EXECUTE ON FUNCTION "public"."record_lifecycle_domain_sync"() FROM "anon";

CREATE TRIGGER "trg_record_lifecycle_domain_sync"
    BEFORE INSERT OR UPDATE ON "public"."record_lifecycle"
    FOR EACH ROW EXECUTE FUNCTION "public"."record_lifecycle_domain_sync"();
