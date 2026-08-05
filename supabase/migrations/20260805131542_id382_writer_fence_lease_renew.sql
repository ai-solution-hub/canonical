-- id-382 — token-scoped lease renewal for the {138.9} writer-fence.
--
-- Companion to the S534 python change (scripts/cocoindex_pipeline/writer_fence.py):
-- the held lease is re-stamped every 20s to expires_at = now()+120s, so a dead
-- holder frees the fence in <=120s instead of the 3600s acquire TTL. The acquire
-- TTL deliberately stays 3600s as the safety floor — on a project without this
-- function the python renewal loop degrades loudly-once (SQLSTATE 42883) and
-- behaviour is byte-for-byte pre-change.
--
-- Safety property (id-382 hard constraint): renewal is fencing-token-scoped and
-- refuses expired leases — it can never touch another holder's lease and never
-- resurrect a lost one. No release-by-fence_name helper exists or may be added.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION "public"."corpus_writer_fence_lease_renew"(
    "p_holder_token" "uuid",
    "p_holder" "text" DEFAULT NULL::"text",
    "p_ttl_seconds" integer DEFAULT 120
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_fence_name text := public._corpus_writer_fence_lease_name();
  v_renewed    boolean;
BEGIN
  IF p_holder_token IS NULL THEN
    RAISE EXCEPTION 'corpus_writer_fence_lease_renew: p_holder_token must not be NULL — renewal is fencing-token-scoped (id-382: a renew can only extend the caller''s own live lease)';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'corpus_writer_fence_lease_renew: p_ttl_seconds must be a positive integer (got %)', p_ttl_seconds;
  END IF;

  UPDATE public.corpus_writer_fence_lease
     SET expires_at = now() + make_interval(secs => p_ttl_seconds)
   WHERE fence_name   = v_fence_name
     AND holder_token = p_holder_token
     AND expires_at   > now()  -- an EXPIRED lease is NOT renewable: the holder may
                               -- have been superseded in the gap; acquire is the
                               -- only path back in. No resurrection.
  RETURNING true INTO v_renewed;

  v_renewed := COALESCE(v_renewed, false);
  IF v_renewed THEN
    RAISE LOG 'corpus_writer_fence_lease_renew: RENEWED by % (token %, fence %, ttl %s)',
      COALESCE(p_holder, 'unnamed'), p_holder_token, v_fence_name, p_ttl_seconds;
  ELSE
    RAISE WARNING 'corpus_writer_fence_lease_renew: NOT RENEWED for token % (%, fence %) — token mismatch, expired, or never held; the caller has LOST the fence and must not assume exclusion',
      p_holder_token, COALESCE(p_holder, 'unnamed'), v_fence_name;
  END IF;
  RETURN v_renewed;
END;
$$;

ALTER FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) TO "service_role";
COMMENT ON FUNCTION "public"."corpus_writer_fence_lease_renew"("uuid", "text", integer) IS 'id-382 — token-scoped renewal: re-stamps expires_at iff p_holder_token matches the CURRENT holder AND the lease is unexpired. Can never touch another holder''s lease. Beaten every 20s by scripts/cocoindex_pipeline/writer_fence.py; python degrades gracefully (42883) when absent.';

-- DR-032 companion exposure, same migration:
CREATE FUNCTION api.corpus_writer_fence_lease_renew(p_holder_token uuid, p_holder text DEFAULT NULL::text, p_ttl_seconds integer DEFAULT 120)
  RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = public, extensions
AS $api$
  SELECT public.corpus_writer_fence_lease_renew(p_holder_token => p_holder_token, p_holder => p_holder, p_ttl_seconds => p_ttl_seconds);
$api$;
REVOKE EXECUTE ON FUNCTION api.corpus_writer_fence_lease_renew(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.corpus_writer_fence_lease_renew(uuid, text, integer) TO authenticated, service_role;
