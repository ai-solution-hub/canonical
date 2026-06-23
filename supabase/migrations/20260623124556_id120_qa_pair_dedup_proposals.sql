-- ID-120 {120.5} P-1 — cross-workspace + cross-form Q&A dedup proposal store.
--
-- Walk-time proposer (ID-120 {120.6}, service-role Python) writes one row per candidate
-- duplicate pair; the curator surface ({120.7} approve/reject API + {120.8} UI, role-scoped
-- TS clients) reads/updates it. The merge write fires only on curator approval — this table
-- NEVER touches the q_a_pairs publication_status / superseded_by path (TECH P-1).
--
-- Two orchestrator reconciliations vs the {120.5} brief / TECH P-1 (S402):
--   (1) RLS idiom. TECH P-1 (lines 130-132) says "mirror the role-based posture of the
--       q_a_pairs policies (20260619120000_rls_initplan_wrap_qa.sql)" BUT also "gated to
--       admin/editor, viewer denied (INV-22)". Those q_a_pairs policies gate on
--       auth.role() IN (authenticated, service_role) — which does NOT deny a viewer (a
--       viewer IS authenticated). The operative intent (INV-22 + the {120.5} testStrategy
--       "RLS denies a viewer SELECT, permits admin/editor") requires app-role gating via
--       public.get_user_role(). Resolved to the established admin/editor idiom used by
--       company_profiles / feed_* (squash baseline 20260617130000 lines 10063-10095), in
--       the (select …) initplan-wrapped form per the ID-116 rls_initplan posture.
--   (2) api-schema exposure (ID-115) is deliberately OUT of this migration — handled in a
--       dedicated subtask ({120.9}) because the generate-api-views.ts generator is
--       post-squash-incompatible for incremental table adds (fixed pre-baseline timestamp +
--       SURFACE_TABLES allowlist). The app types against public (lib/supabase/schema.ts), so
--       Tables<'q_a_pair_dedup_proposals'> resolves from public here; the api view only gates
--       the TS routes' RUNTIME, which {120.9} delivers before {120.7}/{120.8} are verified.

CREATE TABLE IF NOT EXISTS "public"."q_a_pair_dedup_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pair_a_id" "uuid" NOT NULL,
    "pair_b_id" "uuid" NOT NULL,
    "similarity_score" numeric(5,4) NOT NULL,
    "proposed_survivor_id" "uuid" NOT NULL,
    "survivor_reason" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "pair_a_source_workspace_id" "uuid",
    "pair_b_source_workspace_id" "uuid",
    "pair_a_source_form_response_id" "uuid",
    "pair_b_source_form_response_id" "uuid",
    "pair_a_fingerprint" "text",
    "pair_b_fingerprint" "text",
    "resolved_survivor_id" "uuid",
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    -- Canonical pair order (backs INV-4/5 idempotency: one row per unordered {a,b} pair).
    CONSTRAINT "q_a_pair_dedup_proposals_pair_order_check" CHECK (("pair_a_id" < "pair_b_id")),
    -- Nominated survivor must be one of the two pair members (INV-12).
    CONSTRAINT "q_a_pair_dedup_proposals_proposed_survivor_check" CHECK ((("proposed_survivor_id" = "pair_a_id") OR ("proposed_survivor_id" = "pair_b_id"))),
    -- Curator override (when set) must also be one of the two pair members (INV-13).
    CONSTRAINT "q_a_pair_dedup_proposals_resolved_survivor_check" CHECK ((("resolved_survivor_id" IS NULL) OR ("resolved_survivor_id" = "pair_a_id") OR ("resolved_survivor_id" = "pair_b_id"))),
    CONSTRAINT "q_a_pair_dedup_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);

ALTER TABLE "public"."q_a_pair_dedup_proposals" OWNER TO "postgres";

ALTER TABLE ONLY "public"."q_a_pair_dedup_proposals"
    ADD CONSTRAINT "q_a_pair_dedup_proposals_pkey" PRIMARY KEY ("id");

-- INV-4: exactly one proposal row per (canonical-ordered) pair.
ALTER TABLE ONLY "public"."q_a_pair_dedup_proposals"
    ADD CONSTRAINT "q_a_pair_dedup_proposals_pair_unique" UNIQUE ("pair_a_id", "pair_b_id");

-- FK to q_a_pairs; ON DELETE CASCADE so a deleted pair drops its dangling proposals
-- (the proposal store is derived, never the lineage of record — that is q_a_pair_history).
ALTER TABLE ONLY "public"."q_a_pair_dedup_proposals"
    ADD CONSTRAINT "q_a_pair_dedup_proposals_pair_a_id_fkey" FOREIGN KEY ("pair_a_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."q_a_pair_dedup_proposals"
    ADD CONSTRAINT "q_a_pair_dedup_proposals_pair_b_id_fkey" FOREIGN KEY ("pair_b_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;

-- FK index on pair_b_id (pair_a_id is the leftmost column of the UNIQUE index, already covered)
-- — keeps the unindexed_foreign_keys advisor at 0 (ID-116 posture).
CREATE INDEX "idx_q_a_pair_dedup_proposals_pair_b_id" ON "public"."q_a_pair_dedup_proposals" USING "btree" ("pair_b_id");

-- Curator queue read path ({120.8} list page) is "pending proposals" — partial index.
CREATE INDEX "idx_q_a_pair_dedup_proposals_pending" ON "public"."q_a_pair_dedup_proposals" USING "btree" ("created_at") WHERE ("status" = 'pending'::"text");

ALTER TABLE "public"."q_a_pair_dedup_proposals" ENABLE ROW LEVEL SECURITY;

-- RLS — admin/editor only, viewer denied (INV-22). See reconciliation (1) in the header.
-- SELECT + UPDATE policies only: there is intentionally NO INSERT/DELETE policy, so an
-- authenticated viewer/editor cannot INSERT or DELETE (denied by policy absence under RLS),
-- while the service-role proposer (P-3) bypasses RLS entirely for its UPSERT.
CREATE POLICY "q_a_pair_dedup_proposals_select" ON "public"."q_a_pair_dedup_proposals"
    FOR SELECT TO "authenticated"
    USING (((SELECT "public"."get_user_role"()) = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

CREATE POLICY "q_a_pair_dedup_proposals_update" ON "public"."q_a_pair_dedup_proposals"
    FOR UPDATE TO "authenticated"
    USING (((SELECT "public"."get_user_role"()) = ANY (ARRAY['admin'::"text", 'editor'::"text"])))
    WITH CHECK (((SELECT "public"."get_user_role"()) = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

-- Grants. NB: this DB sets ALTER DEFAULT PRIVILEGES granting all of {S,I,U,D,…} on new
-- public tables to anon + authenticated (the repo-standard Supabase posture — confirmed on
-- the catalog post-apply), so anon/authenticated land broad here regardless of the explicit
-- grants below. That is intentional and SAFE: (a) RLS is the real gate — SELECT/UPDATE are
-- admin/editor-only and INSERT/DELETE have NO policy, so RLS default-denies them for every
-- interactive role; (b) under ID-115 the public schema is UNEXPOSED via PostgREST (PGRST106),
-- so anon/authenticated cannot reach this table through the Data API at all — the only API
-- path is the api view ({120.9}), which is least-privilege per generate-api-views.ts INV-10.
-- The explicit grants below are additive (curator app needs SELECT+UPDATE; the proposer
-- writes as service_role via a direct asyncpg connection, not PostgREST).
GRANT ALL ON TABLE "public"."q_a_pair_dedup_proposals" TO "service_role";
GRANT SELECT, UPDATE ON TABLE "public"."q_a_pair_dedup_proposals" TO "authenticated";
