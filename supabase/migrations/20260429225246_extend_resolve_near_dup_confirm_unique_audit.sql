-- §1.9 Near-Duplicate Merge Dashboard — extend confirm-unique RPC with
-- OQ2 audit context (V_W1 F2).
--
-- Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §11 OQ2
--       (similarity_at_resolution + threshold_at_resolution recorded on
--        every resolution row's content_history.metadata)
--
-- The original v1 (`20260429221541_resolve_near_dup_confirm_unique.sql`)
-- did not accept the OQ2 audit fields, so confirm-unique history rows
-- always recorded `null` for similarity / threshold context. The merge
-- route already accepted these, but via a raw-body bypass that
-- `postAdminNearDupMerge`'s typed signature never supplied. This
-- migration extends the RPC signature so:
--   - the route can forward the parsed Zod-validated values
--   - the audit row carries the values that drove the resolution
--
-- PG functions are identified by name + arg types — adding params means
-- we must DROP the v1 signature and re-CREATE with the new signature.
-- The old v1 had no callers post-deploy (route is the only caller and
-- ships in the same change), so the DROP is safe in this revision.

DROP FUNCTION IF EXISTS public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.resolve_near_dup_confirm_unique(
  p_left_id uuid,
  p_right_id uuid,
  p_actor_user_id uuid,
  p_pair_id text,
  p_note text DEFAULT NULL,
  p_similarity_at_resolution numeric DEFAULT NULL,
  p_threshold_at_resolution numeric DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  dedup_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_flipped uuid[];
BEGIN
  -- Idempotent: only flip rows not already in confirmed_unique
  WITH updated AS (
    UPDATE content_items
       SET dedup_status = 'confirmed_unique'
     WHERE content_items.id IN (p_left_id, p_right_id)
       AND content_items.dedup_status <> 'confirmed_unique'
    RETURNING content_items.id
  )
  SELECT array_agg(updated.id) INTO v_flipped FROM updated;

  -- Insert one history snapshot row per actually-flipped member.
  -- Matches v1 column list verbatim — `content_history` requires
  -- title/content/change_type/created_by NOT NULL plus change_reason
  -- (CLAUDE.md gotcha: content_history inserts must include change_reason).
  IF v_flipped IS NOT NULL THEN
    INSERT INTO content_history (
      content_item_id,
      version,
      title,
      content,
      brief,
      detail,
      reference,
      metadata,
      change_type,
      change_summary,
      change_reason,
      created_by
    )
    SELECT
      ci.id,
      COALESCE(
        (SELECT max(ch.version) FROM content_history ch WHERE ch.content_item_id = ci.id),
        0
      ) + 1,
      COALESCE(ci.title, ci.suggested_title, 'Untitled'),
      COALESCE(ci.content, ''),
      ci.brief,
      ci.detail,
      ci.reference,
      jsonb_build_object(
        'pairId', p_pair_id,
        'peerId', CASE WHEN ci.id = p_left_id THEN p_right_id ELSE p_left_id END,
        'note', p_note,
        'similarity_at_resolution', p_similarity_at_resolution,
        'threshold_at_resolution', p_threshold_at_resolution,
        'dedup_review_action', 'confirm_unique'
      ),
      'metadata_change',
      CASE
        WHEN p_note IS NOT NULL AND length(p_note) > 0
          THEN 'Confirmed unique via admin near-dup review: ' || p_note
        ELSE 'Confirmed unique via admin near-dup review'
      END,
      'dedup_admin_review_near_dup_confirmed_unique',
      p_actor_user_id
    FROM content_items ci
    WHERE ci.id = ANY(v_flipped);
  END IF;

  RETURN QUERY
    SELECT content_items.id, content_items.dedup_status::text
      FROM content_items
     WHERE content_items.id IN (p_left_id, p_right_id);
END;
$$;

-- ACL: SECURITY INVOKER (uses caller's RLS); EXECUTE granted to
-- authenticated + service_role; explicit REVOKE FROM anon required
-- because pg_default_acl auto-grants anon EXECUTE on every public.*
-- function (memory: feedback_supabase_pg_default_acl_anon_execute).
REVOKE ALL ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text, numeric, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text, numeric, numeric) IS
  '§1.9 near-dup confirm-unique transactional flip with OQ2 audit context. Sets dedup_status=confirmed_unique on each pair member that is not already confirmed_unique, plus matching content_history snapshot rows in the same transaction. Records similarity_at_resolution + threshold_at_resolution in metadata. Idempotent. Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6, §11 OQ2.';
