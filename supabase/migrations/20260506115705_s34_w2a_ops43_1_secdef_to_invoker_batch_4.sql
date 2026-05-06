-- ============================================================================
-- OPS-43.1 batch 4 — SECURITY DEFINER → SECURITY INVOKER (8 write/admin RPCs)
--                  + WONT-FLIP carve-out documentation (3 service-role-only fns)
-- ============================================================================
--
-- Spec source of truth: docs/audits/kh-production-readiness-phase-1/specs/
--                       wp-ops43-pg-default-acl-spec.md (v4) §3.3.1.
-- Parent migrations:    20260502195036_ops43_1_secdef_to_invoker_batch_1.sql
--                       (kh-prod-readiness-S22 batch 1 — 10 stats getters)
--                       20260502232856_ops43_1_secdef_to_invoker_batch_2.sql
--                       (kh-prod-readiness-S22 batch 2 — 10 list/summary RPCs)
--                       20260506091039_s33_w2_ops43_1_secdef_to_invoker_batch_3.sql
--                       (kh-prod-readiness-S33 batch 3 — 7 read-only RPCs).
--                       This batch (S34-W2a) closes 8 of the remaining 11
--                       SECDEF candidates — the write/admin tier — and
--                       documents 3 service-role-only carve-outs (WONT-FLIP).
--
-- Function search_path discipline — this migration alters existing functions
-- and does not CREATE new PL/pgSQL. The CLAUDE.md gotcha
-- ("All new PL/pgSQL functions MUST include SET search_path = public,
-- extensions") applies to function bodies, not to ALTER FUNCTION SECURITY
-- INVOKER toggles. The underlying functions retain their original
-- search_path settings (pg_proc.proconfig); this migration changes only
-- prosecdef. No proconfig changes are needed.
--
-- Background — OPS-43 IMPL closed the acute anon-exposure surface (REVOKE
-- pass) but left the durable SECDEF surface intact. Batches 1+2+3 closed
-- 27 of the 39 candidates. Batch 4 (this migration) closes a further 8
-- write/admin RPCs that share a uniform risk profile under INVOKER:
-- every call-site flows through `getAuthorisedClient(['admin'])` /
-- `createMcpClient(extra.authInfo)` (JWT-bearer) / `createServiceClient()`
-- after an admin-tier app gate / browser `createClient()` from a UI surface
-- that is itself tier-gated to `canEdit` (admin or editor); every target
-- table has authenticated-tier RLS coverage that matches the tier of the
-- call-sites.
--
-- ─ Carve-outs (WONT-FLIP — 3 functions kept SECDEF) ──────────────────────
-- The remaining 3 of 11 candidates are documented as WONT-FLIP because
-- they are pipeline-only (service-role caller, no app or MCP tool surface).
-- Service-role bypasses RLS regardless of SECDEF/INVOKER, so the SECDEF
-- amplifier provides no privilege benefit — but flipping costs review
-- effort with zero observable behavioural change. Documenting closes the
-- OPS-43.1 scope without a no-op flip.
--
--   1. cleanup_filtered_articles()                  — pipeline DELETE of
--      feed_articles after 90 days. Service-role only — no rpc() callers
--      from app or MCP surfaces (OPS-43 IMPL header confirmed). SECDEF
--      amplifier provides no benefit but flipping is zero-yield review
--      effort. KEEP SECDEF as documented end-state.
--   2. detect_reupload(p_filename text, p_uploaded_by uuid,
--                      p_content_hash text)         — STABLE SQL, reads
--      source_documents. rpc() caller IS app-side (`app/api/upload/
--      route.ts:280`) but invoked via service-role client AFTER an
--      admin/editor `getAuthorisedClient(['admin','editor'])` gate at
--      the route entry. Net access channel: service-role-after-app-tier.
--      Flipping to INVOKER would require `source_documents` SELECT RLS
--      review (current admin/editor SELECT may not satisfy invoke from
--      service-role context with `auth.uid()=NULL`). KEEP SECDEF as
--      documented end-state pending separate INVOKER triage; flip is
--      out of OPS-43.1 batch 4 scope.
--   3. find_exact_duplicates(p_content_hash text,
--                            p_exclude_id uuid DEFAULT NULL)
--                                                  — STABLE SQL, reads
--      content_items. rpc() caller IS app-side (`lib/dedup.ts:80`,
--      reached via `app/api/dedup/check/route.ts:57` which uses
--      `getAuthorisedClient(['admin','editor'])`). User-JWT channel,
--      NOT pipeline-only. content_items has authenticated SELECT
--      qual=true so an INVOKER flip is safe in principle, but the
--      dedup-check write-path is still scoped admin/editor at the route
--      and a flip would alter the rpc-layer access model from
--      SECDEF-amplifier to RLS-policy. KEEP SECDEF as documented
--      end-state pending separate INVOKER triage; flip deferred to a
--      follow-up batch.
--
-- These three are intentionally kept SECDEF as the documented end-state
-- of OPS-43.1. Future re-evaluation should look at the §4.5 spec
-- migration which tightened pg_default_acl: anon EXECUTE is no longer
-- the default for new public.* functions, so the SECDEF amplifier on
-- these three is no longer the latent footgun it was at S20 spec time.
-- The post-batch-4 SECDEF surface narrows to: (a) these 3 carve-outs,
-- (b) `get_user_display_names` (separately escalated to OPS-60 — needs
-- column-grant + RLS-policy refactor), (c) `get_user_role` (intentional
-- SECDEF — the function the RLS access model itself depends on), (d)
-- the 13 trigger-typed functions (no GRANT-based EXECUTE path; SECDEF
-- irrelevant — see spec §3.5).
--
-- ─ Batch 4 scope — 8 write/admin RPCs (FLIP candidates) ──────────────────
--
--   1. bulk_assign_content_owner       — UPDATE content_items
--      (uuid[], uuid, uuid)              .content_owner_id (no internal
--                                        gate; relies on RLS)
--   2. bulk_delete_tags                 — UPDATE content_items
--      (text[], text)                    .ai_keywords/.user_tags. Internal
--                                        `get_user_role()='admin'` gate.
--   3. bulk_merge_tags                  — UPDATE content_items
--      (text[], text, text)              .ai_keywords/.user_tags. Internal
--                                        `get_user_role()='admin'` gate.
--   4. delete_duplicate_entity_mentions — DELETE entity_mentions (no
--      (text)                            internal gate; relies on RLS)
--   5. find_duplicate_tags              — SELECT content_items (read-only
--      (text)                            on a write-batch RPC because it
--                                        powers admin tag-merge UI).
--                                        Internal `auth.uid() IS NULL`
--                                        guard.
--   6. merge_entities                   — UPDATE entity_mentions, UPDATE
--      (text[], text, text)              entity_relationships, DELETE
--                                        entity_mentions (no internal
--                                        gate; relies on RLS)
--   7. run_quality_scan                 — INSERT ingestion_quality_log,
--      (text)                            UPDATE content_items (no
--                                        internal gate; relies on RLS)
--   8. toggle_star (2-arg overload)     — UPDATE content_items.starred
--      (uuid, boolean)                   (no internal gate; relies on
--                                        RLS). NOTE: 1-arg overload
--                                        `toggle_star(item_id uuid)` is
--                                        already INVOKER (returns FALSE
--                                        stub) — NOT touched by this
--                                        migration.
--
-- ─ Per-function triage (spec §3.3.1) ──────────────────────────────────────
--
-- Tables read/written (aggregate distinct, all 8 fns):
--   content_items, entity_mentions, entity_relationships,
--   ingestion_quality_log.
--
-- RLS authenticated-role policy coverage (verified on staging
-- turayklvaunphgbgscat):
--   content_items:
--     SELECT  qual=true                                 (all tiers)
--     INSERT  WITH CHECK get_user_role() IN (admin,editor)
--     UPDATE  qual=get_user_role() IN (admin,editor)
--     DELETE  qual=get_user_role()='admin'
--   entity_mentions:
--     SELECT  qual=true                                 (all tiers)
--     INSERT  WITH CHECK get_user_role() IN (admin,editor)
--     UPDATE  qual=get_user_role() IN (admin,editor)
--     DELETE  qual=get_user_role()='admin'
--   entity_relationships:
--     SELECT  qual=true                                 (all tiers)
--     INSERT  WITH CHECK get_user_role() IN (admin,editor)
--     UPDATE  qual=get_user_role() IN (admin,editor)
--     DELETE  qual=get_user_role()='admin'
--   ingestion_quality_log:
--     SELECT  qual=true                                 (all tiers)
--     INSERT  WITH CHECK get_user_role() IN (admin,editor)
--     UPDATE  qual=get_user_role() IN (admin,editor)
--     (no DELETE policy — DELETE not used by these RPCs.)
--
-- Effective access under INVOKER (per function):
--   bulk_assign_content_owner     UPDATE content_items
--                                 → admin/editor only.
--   bulk_delete_tags              UPDATE content_items
--                                 → admin/editor only AND internal
--                                   `get_user_role()='admin'` raises
--                                   pre-RLS — net effect: admin only.
--   bulk_merge_tags               UPDATE content_items
--                                 → admin/editor only AND internal admin
--                                   gate — net effect: admin only.
--   delete_duplicate_entity_mentions DELETE entity_mentions
--                                 → admin only (RLS DELETE policy).
--   find_duplicate_tags           SELECT content_items
--                                 → all authenticated tiers (qual=true)
--                                   AND internal auth.uid() guard.
--   merge_entities                UPDATE entity_mentions/relationships
--                                 + DELETE entity_mentions
--                                 → DELETE narrows to admin only.
--   run_quality_scan              INSERT ingestion_quality_log + UPDATE
--                                 content_items
--                                 → admin/editor only.
--   toggle_star (2-arg)           UPDATE content_items.starred
--                                 → admin/editor only.
--
-- ─ Call-site auth-channel verification ────────────────────────────────────
-- Every production call-site uses an authenticated channel and the
-- channel's tier matches or exceeds the post-INVOKER RLS requirement:
--
--   bulk_assign_content_owner:
--     - app/api/content-owners/bulk-assign/route.ts:87
--       getAuthorisedClient(['admin']) → admin tier; satisfies UPDATE
--       admin/editor RLS.
--     - lib/mcp/tools/content.ts:1231 + :1640 (bulk_assign_owner MCP tool
--       slot 32). createMcpClient(extra.authInfo) → JWT bearer (any
--       authenticated tier). MCP tool annotated NON_IDEMPOTENT_WRITE +
--       admin checkMcpRole() — verified admin gate above the rpc() call.
--
--   bulk_delete_tags:
--     - app/api/tags/bulk-delete/route.ts:37
--       getAuthorisedClient(['admin']) → admin tier; redundant w/ internal
--       admin gate but defence-in-depth at app + RLS + body layers.
--
--   bulk_merge_tags:
--     - app/api/tags/bulk-merge/route.ts:41
--       getAuthorisedClient(['admin']) → admin tier; same defence-in-depth.
--
--   delete_duplicate_entity_mentions:
--     - No production rpc() callers (admin entity-merge utility, latent).
--       Confirmed in OPS-43 IMPL annotation: "no call-sites (admin entity
--       merge utility)". Under INVOKER: any future caller must reach
--       admin-tier RLS to use it. Behaviour: identical to current
--       no-callers state.
--
--   find_duplicate_tags:
--     - app/api/tags/duplicates/route.ts:39
--       getAuthorisedClient() → any authenticated tier; internal
--       auth.uid() guard (raises if NULL) is the actual gate. RLS read of
--       content_items (qual=true) succeeds for all authenticated tiers.
--
--   merge_entities:
--     - app/api/entities/merge/route.ts:48
--       getAuthorisedClient(['admin']) → admin tier app gate, then
--       createServiceClient().rpc(...). Service-role bypasses RLS by
--       default — the function executes with service-role privileges
--       even under INVOKER (RLS not enforced for service_role on the
--       target tables). Behaviour: identical to current SECDEF state.
--
--   run_quality_scan:
--     - No production rpc() callers. Confirmed in OPS-43 IMPL annotation:
--       "no current rpc() call-sites; SECDEF historical-only". Under
--       INVOKER: any future caller must reach admin-or-editor tier for
--       the INSERT/UPDATE policies. Behaviour: identical to current
--       no-callers state.
--
--   toggle_star (2-arg):
--     - components/shared/star-button.tsx:46
--     - hooks/use-item-detail-data.ts:307
--       Both use createClient() from @/lib/supabase/client (browser
--       singleton, user JWT post-login). Pages rendering StarButton
--       gate visibility on `canEdit = role === 'admin' || role ===
--       'editor'` (hooks/use-user-role.ts:39). Viewer tier never sees
--       the button — RLS UPDATE policy
--       `qual=get_user_role() IN ('admin','editor')` aligns with the UI
--       gate, so INVOKER preserves access semantics.
--
-- Decision: all 8 candidates flip from SECDEF → INVOKER. SECDEF wrapping
-- was historical-only — UI/route layers already gate to the tier RLS
-- requires. INVOKER + existing RLS preserves access semantics with no
-- behaviour change for any signed-in user, and removes the SECDEF
-- amplifier from the durable SECDEF surface.
--
-- ─ Pattern (mirrors batches 1+2+3 verbatim) ───────────────────────────────
-- Every ALTER wraps in DO $$ ... $$ with WHEN undefined_function THEN
-- NULL exception handling so fresh-DB replay against partial schemas
-- (where a function may not exist yet) does not error.
--
-- Function signatures use pg_get_function_identity_arguments() output
-- verbatim (e.g. `uuid[], uuid, uuid`, `text[], text, text`). For
-- toggle_star, only the 2-arg overload (uuid, boolean) is targeted —
-- the 1-arg stub overload (uuid) is already INVOKER (verified on
-- staging pre-apply: prosecdef=false for pronargs=1, prosecdef=true
-- for pronargs=2).
--
-- ─ Smoke-call args used to validate per-function post-apply ───────────────
-- (Executed by IMPL author against staging immediately after MCP
-- apply_migration; non-destructive args where possible.)
--   1. bulk_assign_content_owner       — empty p_item_ids='{}' array
--                                       (returns 0; no rows touched)
--   2. bulk_delete_tags                 — empty p_tags='{}' array, type
--                                       'ai' (admin gate gate-checked
--                                       first; returns 0 if admin)
--   3. bulk_merge_tags                  — empty p_sources='{}' array,
--                                       'ai' type (admin-gated; returns 0)
--   4. delete_duplicate_entity_mentions — bogus canonical_name
--                                       ('__nonexistent__'); returns 0
--   5. find_duplicate_tags              — 'ai' type; returns rowset
--                                       (possibly empty on data-empty
--                                       staging branch)
--   6. merge_entities                   — empty p_source_names='{}';
--                                       fails validation
--                                       ('Source names array must not be
--                                       empty') — verifies entry path
--                                       reachable
--   7. run_quality_scan                 — 'smoke_test' batch name; full
--                                       INSERT/UPDATE pass on staging
--                                       data (data-empty staging is
--                                       graceful; returns 4-row summary)
--   8. toggle_star (2-arg)              — bogus item_id (UUID v4 not in
--                                       table); UPDATE matches 0 rows;
--                                       returns void
--
-- Verification — tail block runs the post-apply AC query and RAISES NOTICE
-- (not EXCEPTION) if any of the 8 candidate functions remains SECDEF.
-- Apply-safe (no transaction abort).
--
-- The 7-name AC list in the verification block excludes toggle_star
-- because the proname filter would also match the 1-arg INVOKER stub
-- (which prosecdef=false already). The 2-arg overload is verified with
-- a separate (overload-discriminated) AC query in the IMPL handoff.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- §3.3.1 — Per-function ALTER FUNCTION ... SECURITY INVOKER
-- ----------------------------------------------------------------------------

-- 1. bulk_assign_content_owner — UPDATE content_items.content_owner_id.
--    No internal gate. RLS UPDATE narrows to admin/editor; both prod
--    call-sites are admin-tier (getAuthorisedClient(['admin']) +
--    MCP admin checkMcpRole). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.bulk_assign_content_owner(uuid[], uuid, uuid) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 2. bulk_delete_tags — UPDATE content_items.ai_keywords/.user_tags.
--    Internal `get_user_role()='admin'` raise pre-RLS (works identically
--    under INVOKER). RLS UPDATE narrows to admin/editor; internal gate
--    further narrows to admin. Sole prod call-site is admin-gated. SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.bulk_delete_tags(text[], text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 3. bulk_merge_tags — UPDATE content_items.ai_keywords/.user_tags.
--    Internal `get_user_role()='admin'` raise pre-RLS. Sole prod call-
--    site is admin-gated. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.bulk_merge_tags(text[], text, text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 4. delete_duplicate_entity_mentions — DELETE entity_mentions.
--    No internal gate. RLS DELETE narrows to admin. No production
--    callers today; future callers must reach admin tier. SECDEF
--    historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.delete_duplicate_entity_mentions(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 5. find_duplicate_tags — SELECT content_items.
--    Internal `IF auth.uid() IS NULL THEN RAISE` guard already enforces
--    JWT presence; works identically under INVOKER. Mirrors batch 1's
--    get_tag_counts_filtered + batch 3's get_tags_by_domain pattern.
--    Sole prod call-site uses getAuthorisedClient (any auth tier).
--    Read of content_items (qual=true) succeeds for all auth tiers.
--    SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.find_duplicate_tags(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 6. merge_entities — UPDATE entity_mentions, UPDATE entity_relationships,
--    DELETE entity_mentions. No internal gate. Sole prod call-site uses
--    createServiceClient() (service-role bypasses RLS for the entire
--    transaction). INVOKER preserves behaviour identically because
--    service-role is exempt from RLS by default. SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.merge_entities(text[], text, text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 7. run_quality_scan — INSERT ingestion_quality_log + UPDATE content_items.
--    No internal gate. RLS narrows to admin/editor. No production callers
--    today. Default arg counts as one arg in identity-arguments
--    (`p_batch_name text` with DEFAULT). SECDEF historical-only.
DO $$
BEGIN
  ALTER FUNCTION public.run_quality_scan(text) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;

-- 8. toggle_star (2-arg overload) — UPDATE content_items.starred.
--    No internal gate. RLS UPDATE narrows to admin/editor. Both prod
--    call-sites use createClient() browser singleton from UI surfaces
--    that are tier-gated to canEdit (admin/editor); viewers never see
--    StarButton. The 1-arg overload `toggle_star(item_id uuid)` is
--    already INVOKER (returns FALSE stub) and is intentionally NOT
--    touched. SECDEF historical-only on the 2-arg overload.
DO $$
BEGIN
  ALTER FUNCTION public.toggle_star(uuid, boolean) SECURITY INVOKER;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
END;
$$;


-- ============================================================================
-- §3.3.1 verification block (NOTICE-only; no transaction abort).
-- Expected v_remaining_secdef = 0 — all 7 single-overload candidates
-- flipped to INVOKER. (toggle_star excluded from this proname filter
-- because the 1-arg stub overload is already INVOKER and would not match
-- prosecdef=true; the 2-arg overload is verified separately in the IMPL
-- handoff via overload-discriminated query.)
-- ============================================================================

DO $$
DECLARE
  v_remaining_secdef integer;
BEGIN
  SELECT count(*) INTO v_remaining_secdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND p.prosecdef
    AND p.proname IN (
      'bulk_assign_content_owner',
      'bulk_delete_tags',
      'bulk_merge_tags',
      'delete_duplicate_entity_mentions',
      'find_duplicate_tags',
      'merge_entities',
      'run_quality_scan'
    );

  IF v_remaining_secdef > 0 THEN
    RAISE NOTICE 'OPS-43.1 batch 4: % candidate functions still SECDEF (expected = 0)', v_remaining_secdef;
  END IF;
END
$$;


-- ============================================================================
-- AC verification (run separately post-apply, not as part of the migration
-- transaction). Across the 7 single-overload flipped functions, count
-- must be 0:
--
--   SELECT count(*) FROM pg_proc
--   WHERE prokind='f' AND prosecdef
--     AND pronamespace = 'public'::regnamespace
--     AND proname IN ('bulk_assign_content_owner','bulk_delete_tags',
--                     'bulk_merge_tags','delete_duplicate_entity_mentions',
--                     'find_duplicate_tags','merge_entities',
--                     'run_quality_scan');
--
-- toggle_star verified separately (overload-discriminated):
--
--   SELECT pg_get_function_identity_arguments(oid) AS args, prosecdef
--   FROM pg_proc
--   WHERE proname='toggle_star' AND pronamespace='public'::regnamespace
--   ORDER BY pronargs;
--
--   Expected post-apply:
--     args='item_id uuid'                       prosecdef=false (untouched)
--     args='p_item_id uuid, p_starred boolean'  prosecdef=false (FLIPPED)
--
-- The 3 carve-out functions (cleanup_filtered_articles, detect_reupload,
-- find_exact_duplicates) remain SECDEF post-apply as documented WONT-FLIP
-- end-state (see header). They are not part of the AC count above.
-- ============================================================================
