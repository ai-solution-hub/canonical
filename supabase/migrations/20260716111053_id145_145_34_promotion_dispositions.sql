-- ID-145 {145.34} — append-only promotion disposition audit table (v1 —
-- owner ruling S474, elevated from backlog to a v1 subtask on staff-engineer
-- review of {145.30}).
--
-- Two gaps closed:
--   Gap 1 (no audit) — {145.30}'s reject path reconciles the extraction's
--     carried fields DOWN to the pair's current values, destroying what was
--     PROPOSED (and by whom, and when) with no durable record. This table is
--     a per-action snapshot: one row per accept/edit/reject, capturing the
--     proposed carried fields, the reviewer, and the timestamp.
--   Gap 2 (reject not durable across re-walks) — a corpus re-walk can
--     re-UPSERT the same source, re-diverging the extraction so the RPC's
--     branch-3 diff predicate
--     (20260707140000_id138_promotion_candidates_published_diff.sql) re-fires
--     an IDENTICAL proposal a human already rejected. The app-side fix
--     (lib/q-a-pairs/promotion-candidate-review.ts) consults the latest
--     disposition for the extraction and suppresses a re-fired identical
--     rejected proposal — this migration only adds the storage + index that
--     lookup reads.
--
-- APPEND-ONLY BY POLICY ABSENCE (mirrors the q_a_pair_dedup_proposals idiom,
-- 20260623124556_id120_qa_pair_dedup_proposals.sql): RLS is ENABLEd with
-- INSERT + SELECT policies ONLY for admin/editor (public.get_user_role(),
-- the repo's role-based RLS idiom — supabase/CLAUDE.md). There is
-- deliberately NO UPDATE and NO DELETE policy, so any authenticated role is
-- denied both by policy absence under RLS — the audit trail cannot be
-- mutated or erased from the app surface. No PL/pgSQL / set_config in this
-- migration (pure table + index + RLS), so the DR-035 born-locked-functions
-- posture does not apply here.
--
-- `actor` is NOT NULL FK to auth.users(id) with NO ON DELETE clause (default
-- NO ACTION) — mirrors the `notifications.user_id` / `read_marks.user_id`
-- precedent (squash baseline) for a NOT-NULL user-reference column that is
-- NOT itself scoped/owned by that user (unlike
-- user_notification_prefs.user_id, which CASCADEs): an audit row must
-- outlive the reviewer's account, so deleting a user who has recorded
-- dispositions is blocked rather than silently dropping (or worse,
-- orphaning) the audit trail.
--
-- AUTHORED-ONLY (ID-145 {145.34} dispatch brief): this migration is a
-- standalone post-push migration — it rides the next coordinated deploy, NOT
-- applied here. No `supabase db push`.
--
-- UK English throughout (DD/MM/YYYY). Authored 16/07/2026.

CREATE TABLE IF NOT EXISTS "public"."promotion_dispositions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extraction_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "actor" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "proposed_snapshot" "jsonb" NOT NULL,
    CONSTRAINT "promotion_dispositions_action_check" CHECK (("action" = ANY (ARRAY['accept'::"text", 'edit'::"text", 'reject'::"text"])))
);

ALTER TABLE "public"."promotion_dispositions" OWNER TO "postgres";

ALTER TABLE ONLY "public"."promotion_dispositions"
    ADD CONSTRAINT "promotion_dispositions_pkey" PRIMARY KEY ("id");

-- Audit rows are derived from (and die with) their source extraction — an
-- erased extraction takes its disposition history with it.
ALTER TABLE ONLY "public"."promotion_dispositions"
    ADD CONSTRAINT "promotion_dispositions_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "public"."q_a_extractions"("id") ON DELETE CASCADE;

-- Audit provenance: who recorded the disposition. NOT NULL, NO ON DELETE
-- clause (see header) — an audit row must outlive the reviewer's account.
ALTER TABLE ONLY "public"."promotion_dispositions"
    ADD CONSTRAINT "promotion_dispositions_actor_fkey" FOREIGN KEY ("actor") REFERENCES "auth"."users"("id");

-- Gap-2 lookup: "latest disposition for this extraction" — ORDER BY
-- created_at DESC LIMIT 1 per extraction_id (also covers the FK's
-- unindexed_foreign_keys advisor, ID-116 posture).
CREATE INDEX "idx_promotion_dispositions_extraction_id_created_at" ON "public"."promotion_dispositions" USING "btree" ("extraction_id", "created_at" DESC);

ALTER TABLE "public"."promotion_dispositions" ENABLE ROW LEVEL SECURITY;

-- RLS — admin/editor only (mirrors the routes' own auth gate,
-- getAuthorisedClient(['admin','editor'])); viewer denied. INSERT + SELECT
-- policies ONLY: there is intentionally NO UPDATE/DELETE policy, so the
-- audit trail cannot be mutated or erased by any authenticated role
-- (append-only by policy absence under RLS).
CREATE POLICY "promotion_dispositions_select" ON "public"."promotion_dispositions"
    FOR SELECT TO "authenticated"
    USING (((SELECT "public"."get_user_role"()) = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

CREATE POLICY "promotion_dispositions_insert" ON "public"."promotion_dispositions"
    FOR INSERT TO "authenticated"
    WITH CHECK (((SELECT "public"."get_user_role"()) = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

-- Grants. Same posture as q_a_pair_dedup_proposals (20260623124556): this DB
-- grants broad default privileges to anon/authenticated on new public
-- tables, but RLS is the real gate — SELECT/INSERT are admin/editor-only and
-- UPDATE/DELETE have NO policy, so RLS default-denies them for every
-- interactive role. public is UNEXPOSED via PostgREST (ID-115); the only API
-- path is the api schema — an api.promotion_dispositions view (mirroring
-- q_a_extractions / q_a_pairs's SURFACE_TABLES exposure,
-- scripts/generate-api-views.ts) is a follow-up, not part of this migration
-- (flagged out-of-scope in the {145.34} journal).
GRANT ALL ON TABLE "public"."promotion_dispositions" TO "service_role";
GRANT SELECT, INSERT ON TABLE "public"."promotion_dispositions" TO "authenticated";
