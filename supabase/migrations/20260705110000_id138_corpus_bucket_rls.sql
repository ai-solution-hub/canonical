-- ID-138 {138.18} — storage.objects RLS for the private `corpus` bucket
-- (`CORPUS_BUCKET = 'corpus'`, lib/edit-intent/write-back.ts:73; bucket
-- provisioned per-project by scripts/provision-corpus-bucket.ts, {138.8}).
--
-- WHY THIS MIGRATION EXISTS: ZERO storage.objects RLS policies exist for the
-- corpus bucket today. Two AUTHED-client PUT legs write into it directly with
-- the caller's own session (not service_role):
--   - {138.12} write-back (lib/edit-intent/write-back.ts) — `bucket.download()`
--     to snapshot prior bytes, then `bucket.upload(objectKey, ..., { upsert:
--     true })` to PUT (both the edit-back path and the q_a-pairs sidecar
--     MATERIALISE path, app/api/q-a-pairs/[id]/route.ts, share this primitive).
--   - {138.13} upload (lib/upload/folder-drop.ts) — `bucket.upload(destPath,
--     ..., { upsert: true })` only (no download/list call in this leg).
-- Both routes gate entry on `getAuthorisedClient(['admin', 'editor'])`
-- (app/api/items/[id]/route.ts:54, app/api/ingest/folder-drop/route.ts:54,
-- app/api/q-a-pairs/[id]/route.ts:217) — this repo's RLS is role-based via
-- `public.get_user_role()` (supabase/CLAUDE.md), so the storage policies
-- below mirror that same admin+editor gate (least privilege — no anon, no
-- public, no bare-authenticated-any-role access). Without these policies the
-- two authed legs 403 live the moment a real (non-service-role) session hits
-- them (S449 finding).
--
-- Operation coverage (grounded in the actual TS call sites above, not
-- assumed): INSERT + UPDATE (upsert:true resolves to an INSERT ... ON
-- CONFLICT DO UPDATE against storage.objects — Postgres evaluates the INSERT
-- policy for the non-conflicting path and the UPDATE policy [USING + WITH
-- CHECK] for the conflicting-row path, so both are required for either leg's
-- upsert to succeed) + SELECT (write-back.ts's explicit `bucket.download()`
-- snapshot read is a direct SELECT-gated access; also covers the storage
-- engine's internal existence check some upsert implementations perform
-- before choosing insert vs update). No DELETE policy — neither leg calls
-- `.remove()` on the corpus bucket (grepped clean across both files + their
-- callers). No anon/public policy at all — Postgres RLS defaults to deny
-- when no policy matches, so omitting an anon grant already closes that
-- door; service_role is unaffected (it bypasses RLS entirely, so the Python
-- pipeline leg that reads/writes this bucket via service_role keeps working
-- unchanged).
--
-- S449 OWNER RULING: resolve via role-scoped policy migration (this file),
-- NOT by switching either leg onto the service client. Authored here;
-- APPLY IS OWNER-GATED (S449 approval) — this migration is NOT applied by
-- this Subtask. Per-client standups pick it up via the normal migration
-- chain on their own `supabase db push`.
--
-- KNOWN HAZARD (do not attempt to apply from this Subtask): `CREATE POLICY
-- ON storage.objects` via `supabase db push` can fail with "must be owner of
-- table objects" on hosted Supabase projects, because `storage.objects` is
-- owned by the `supabase_storage_admin` role, not the migration role `db
-- push` connects as. FALLBACK if `db push` rejects this file: apply the
-- `CREATE POLICY` statements below via the Supabase Dashboard's SQL Editor
-- (which runs as `supabase_admin`/`postgres` with the needed grant) on each
-- project, OR via `supabase migration up --linked` after confirming the
-- linked role has ownership. Verification probe post-apply: `pg_policies`
-- shows the three policies below; an authed editor PUT succeeds; an anon PUT
-- is rejected (403). This is the Orchestrator's job at apply time, not this
-- Subtask's.

CREATE POLICY "Admin and editor can insert corpus objects" ON "storage"."objects"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "bucket_id" = 'corpus'
    AND "public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])
  );

CREATE POLICY "Admin and editor can update corpus objects" ON "storage"."objects"
  FOR UPDATE TO "authenticated"
  USING (
    "bucket_id" = 'corpus'
    AND "public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])
  )
  WITH CHECK (
    "bucket_id" = 'corpus'
    AND "public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])
  );

CREATE POLICY "Admin and editor can read corpus objects" ON "storage"."objects"
  FOR SELECT TO "authenticated"
  USING (
    "bucket_id" = 'corpus'
    AND "public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])
  );
