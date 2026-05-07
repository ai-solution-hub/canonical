-- OPS-43.1 batch 5 — final SECDEF→INVOKER flips for `detect_reupload` + `find_exact_duplicates`.
--
-- Rationale: per `.planning/.research/s37-housekeeping/ops-43-1-best-practice-investigation.md`
-- (S37 W3 best-practice investigation), both target tables (`source_documents` for
-- `detect_reupload`; `content_items` for `find_exact_duplicates`) carry SELECT RLS policies
-- with `qual = true` for the `authenticated` role. INVOKER posture provides identical reach
-- to SECDEF in this configuration; SECDEF is therefore a no-op privilege amplifier per the
-- `security-rls-performance` skill's least-privilege rule.
--
-- Out of OPS-43.1 scope (documented carve-outs):
--   - `cleanup_filtered_articles()` — service-role-only caller (cron); SECDEF is a no-op
--     amplifier; flip is zero-yield. KEEP SECDEF.
--   - `get_user_role()` — canonical RLS-internal helper; SELECT policy on `user_roles` is
--     self-referential (`qual` calls `get_user_role()`); SECDEF prevents recursion. KEEP SECDEF.
--   - `run_quality_scan()` — independent CHECK-constraint bug (OPS-63); orthogonal to
--     SECDEF/INVOKER posture (already INVOKER post-batch-4).
--
-- No RLS policy changes — `qual = true` for `authenticated` already permits these reads
-- under INVOKER for `source_documents` SELECT and `content_items` SELECT.
-- `search_path` stays pinned (`public, extensions`); anon EXECUTE already revoked via OPS-43 main.

ALTER FUNCTION public.detect_reupload(text, uuid, text) SECURITY INVOKER;
ALTER FUNCTION public.find_exact_duplicates(text, uuid) SECURITY INVOKER;
