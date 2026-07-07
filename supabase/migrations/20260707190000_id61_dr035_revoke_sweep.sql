-- ID-61.14 — DR-035 anon-EXECUTE hardening: one-time audit + REVOKE sweep.
--
-- CONTEXT: the {131.19} S450 GO ran the check-api-view-coverage.ts INV-20 gate
-- live against staging for the first time (the gate has existed since
-- ID-115.10 but had never actually been run against a hosted DB) and found it
-- failing on BOTH exposed schemas: 34 of 35 anon-callable `api` functions and
-- 68 of 69 anon-callable `public` functions (should be 1 each — set_config,
-- the deliberate INV-20 anon entrypoint PostgREST needs for the RLS GUC
-- context). ROOT CAUSE (confirmed empirically against staging rbwqewalexrzgxtvcqrh
-- at {61.14}): the Supabase platform bootstraps `ALTER DEFAULT PRIVILEGES FOR
-- ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,
-- authenticated, service_role`, so EVERY hand-authored `public` function
-- created without an explicit REVOKE is born anon-callable; the S410
-- (20260624120000) fix only closed the `api` schema (the one the Data API
-- actually exposes) and left `public` as "latent, no action needed" — but
-- `generate-api-views.ts` mirrors each `public` fn's live grant list onto its
-- `api` wrapper on every regen, so `public` drift silently re-opens `api`
-- (caught live: q_a_extractions_promotion_candidates, fixed ad-hoc at
-- 20260706180000 — this migration is the systematic sweep that fix was a
-- preview of, plus the public-schema half {59.21}/S410 deliberately deferred).
--
-- This migration is the S410 "client-exact posture pattern" (blanket REVOKE
-- ON ALL FUNCTIONS, then targeted per-function overrides) extended to BOTH
-- schemas. The companion migration 20260707190500_id61_dr035_default_privileges.sql
-- is the mechanism that stops this class of drift recurring for FUTURE
-- functions (ALTER DEFAULT PRIVILEGES + a born-locked event trigger).
--
-- api/public functions are all explicit-ACL (no default/PUBLIC-only grants
-- once a hand-authored migration or the generator has touched them), so the
-- schema-wide REVOKE removes the explicit anon/PUBLIC grants without
-- disturbing the authenticated / service_role grants already in place.
-- Re-runnable (idempotent) — a no-op once the posture is already in place.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC, anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Match the client-exact posture: these 3 auth-probe/count helpers are
-- service_role-only (never authenticated/anon) — S410 already applied this to
-- the `api` copies (20260624120000); extend the SAME override to their
-- `public` originals. This matters even though `public` is not Data-API-
-- exposed: the `api.*` INVOKER wrappers call `public.*` in the CALLER's
-- security context (SECURITY INVOKER, not DEFINER), so an authenticated
-- caller reaching the api wrapper also needs — and, if this override were
-- skipped, WOULD retain — direct EXECUTE on the public original.
REVOKE EXECUTE ON FUNCTION api._test_delete_broken_auth_user(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION api._test_insert_broken_auth_user(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION api.count_auth_users() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._test_delete_broken_auth_user(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._test_insert_broken_auth_user(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.count_auth_users() FROM authenticated;

-- Restore the single intended anon entrypoint in BOTH schemas (INV-20) — the
-- blanket ALL-FUNCTIONS revoke above strips it along with everything else.
GRANT EXECUTE ON FUNCTION api.set_config(text, text, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.set_config(text, text, boolean) TO anon;

-- CARE-LIST NOTE (no SQL action needed, documented for the record): the auth
-- trigger functions public.handle_new_user / public.handle_user_update
-- (SECURITY DEFINER, attached as triggers on auth.users) do NOT need anon
-- EXECUTE to fire — Postgres does not ACL-check EXECUTE when a trigger fires
-- (only CREATE TRIGGER itself is checked, against the creating/migration
-- role). The blanket revoke above correctly strips their anon grant; no
-- re-grant follows, by design. Same reasoning covers every other trigger fn
-- caught by the sweep (coerce_empty_classification_to_null,
-- coerce_null_token_columns, form_response_auto_version,
-- form_templates_outcome_form_type_check,
-- form_templates_recompute_rollup_trigger, q_a_pairs_history_trigger,
-- record_lifecycle_domain_sync, record_lifecycle_mint_q_a_pair,
-- record_lifecycle_mint_source_document, set_classification_disputes_updated_at,
-- snapshot_form_response_history, update_updated_at_column,
-- update_user_notification_prefs_updated_at, validate_layer_key — confirmed
-- against pg_trigger on staging at {61.14}).
--
-- Fence fns (corpus_writer_fence_*) and the id138 SECURITY DEFINER RPCs keep
-- their existing authenticated/service_role grants untouched by this sweep —
-- only PUBLIC/anon is revoked; the blanket statement does not touch other
-- roles. hybrid_search / q_a_search / reference_search / q_a_get_verbatim /
-- reference_get_verbatim / question_match_search / question_match_recompute /
-- search_content / search_content_chunks / search_for_form_response also lose
-- ONLY anon here (product call, {131.19} S450: no anonymous search surface) —
-- their authenticated/service_role grants are unaffected.
