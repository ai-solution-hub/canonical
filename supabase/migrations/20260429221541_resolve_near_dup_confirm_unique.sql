-- §1.9 Near-Duplicate Merge Dashboard — confirm-unique RPC
--
-- Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6, §4.2
--
-- Transactional confirm-unique flip for a near-dup pair. Writes BOTH the
-- content_items.dedup_status update AND the corresponding content_history
-- snapshot rows in a single transaction so that a partial-state failure
-- (one row flipped, one history row written, second insert errors) cannot
-- happen.
--
-- The route handler (`/api/admin/content-dedup/near-duplicates/[pairId]/
-- confirm-unique`) calls this RPC; the JS-orchestrated alternative was
-- ratified out per S209 V_B2 D4 (transactional integrity required).
--
-- Idempotency: only flips rows whose `dedup_status <> 'confirmed_unique'`,
-- and only writes a content_history row per row that was actually flipped.
-- Re-invoking with both rows already in confirmed_unique is a no-op (no
-- history rows written, returns the current pair state).
--
-- Audit trail per §4.3: change_reason is the literal
-- 'dedup_admin_review_near_dup_confirmed_unique'; change_type is
-- 'metadata_change' (per §1.7 confirm-unique convention); metadata JSON
-- includes pairId + peerId (the OTHER pair member) + optional note.
-- §1.7 OQ2-aligned: similarity_at_resolution + threshold_at_resolution
-- are written by the route handler's metadata payload (caller-supplied
-- via p_pair_id encoded with similarity context — see route code).
--
-- ACL: SECURITY INVOKER (uses caller's RLS); EXECUTE granted to
-- authenticated + service_role; explicit REVOKE FROM anon required because
-- pg_default_acl auto-grants anon EXECUTE on every public.* function
-- (memory: feedback_supabase_pg_default_acl_anon_execute).

CREATE OR REPLACE FUNCTION public.resolve_near_dup_confirm_unique(
  p_left_id uuid,
  p_right_id uuid,
  p_actor_user_id uuid,
  p_pair_id text,
  p_note text DEFAULT NULL
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
  -- The history row carries a full snapshot (title/content/etc.) per the
  -- §1.7 confirm-unique convention; version is computed per-row as
  -- (max existing version + 1).
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

REVOKE ALL ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_near_dup_confirm_unique(uuid, uuid, uuid, text, text) IS
  '§1.9 near-dup confirm-unique transactional flip. Sets dedup_status=confirmed_unique on each pair member that is not already confirmed_unique, plus matching content_history snapshot rows in the same transaction. Idempotent. Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §5.6.';
