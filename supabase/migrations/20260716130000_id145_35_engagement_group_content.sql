-- ID-145 {145.35} — engagement_group_content: additive M:N link table between
-- engagement_groups and q_a_pairs (BI-33 owner ruling, S479 — resolves the
-- {145.35} design-pass schema-shape OQ oq-e33a9637413a3c94).
--
-- OWNER RULING (Liam via parent, S479 — unblocks this Subtask):
--   - Schema shape = (b): THIS table. Additive; keeps q_a_pairs.
--     source_form_instance_id (provenance/lineage, {145.23}) untouched — it is
--     NOT re-pointed or repurposed as a live "assign to any group" target.
--     Shape (a) (route assignment through source_form_instance_id) was
--     REJECTED in the design pass: it would destroy provenance. Shape (c)
--     (fold into ID-147 form_attachments) is DEFERRED — form_attachments
--     (20260716113306_id147_form_attachments.sql) is a labelled document
--     store (a CV, a signed PDF), not a set-membership link; conflating the
--     two would give form_attachments an XOR-scope check that no longer
--     holds for a genuine M:N.
--   - Endpoint grain = GROUP-SIDE BATCH (one engagement group, many q_a_pairs
--     per call) — not pair-side. See the {145.35} API subtask
--     (app/api/engagement-groups/[id]/content/route.ts) for the write path.
--
-- AUTHORED-ONLY — rides the next coordinated deploy, NOT applied here (Lane
-- B2 convention; mirrors 20260716113306_id147_form_attachments.sql and
-- 20260716111053_id145_145_34_promotion_dispositions.sql). `supabase db push`
-- is deliberately NOT run against this file — the deploy lane sequences it.
--
-- RLS mirrors engagement_groups (20260712062000 STEP 6) / form_attachments
-- (20260716113306) exactly: SELECT for any authenticated member (form-first
-- "any authenticated member may read"); INSERT/UPDATE/DELETE gated on
-- get_user_role() IN ('admin','editor') (BI-47); NO anon table grant (the
-- stricter posture those two tables use, not the blanket GRANT ALL ... TO
-- anon capped-by-RLS pattern most sibling tables use). No new functions here,
-- so no search_path / anon-EXECUTE work (DR-035 born-locked applies to
-- functions only).
--
-- UNIQUE(engagement_group_id, q_a_pair_id) makes the group-side batch assign
-- endpoint idempotent: it upserts with onConflict on this pair + ignoreDuplicates,
-- so re-posting an already-linked pair is a silent no-op rather than a
-- duplicate row or a 409.
--
-- Deletion semantics fall out of the FKs (both ON DELETE CASCADE): removing
-- an engagement group drops its content links (never the q_a_pairs
-- themselves — the FK is on THIS join table, not on q_a_pairs); removing a
-- q_a_pair drops its group links. Neither cascade ever touches the other
-- side's owning row.
--
-- Behaviour-first tests (endpoint logic against a mock Supabase client) land
-- in the {145.35} API subtask commit, not here — this migration is not
-- pushed, so no live-DB RLS/constraint test can run against it yet.
--
-- UK English throughout (DD/MM/YYYY). Authored 16/07/2026.

CREATE TABLE "public"."engagement_group_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "engagement_group_id" "uuid" NOT NULL,
    "q_a_pair_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "engagement_group_content_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "engagement_group_content_group_pair_unique" UNIQUE ("engagement_group_id", "q_a_pair_id")
);

ALTER TABLE "public"."engagement_group_content" OWNER TO "postgres";

COMMENT ON TABLE "public"."engagement_group_content" IS 'ID-145 {145.35} BI-33 owner ruling (S479) — additive M:N link between engagement_groups and q_a_pairs. Assigning a library item (q_a_pair) to an engagement group is a LINK, exactly like form_instances.engagement_group_id (W1c STEP 6): it does not re-point q_a_pairs.source_form_instance_id (provenance/lineage, {145.23}) and does not move or copy the pair. Written via the group-side batch endpoint, app/api/engagement-groups/[id]/content/route.ts.';

ALTER TABLE "public"."engagement_group_content"
    ADD CONSTRAINT "engagement_group_content_engagement_group_id_fkey"
    FOREIGN KEY ("engagement_group_id") REFERENCES "public"."engagement_groups"("id") ON DELETE CASCADE;

ALTER TABLE "public"."engagement_group_content"
    ADD CONSTRAINT "engagement_group_content_q_a_pair_id_fkey"
    FOREIGN KEY ("q_a_pair_id") REFERENCES "public"."q_a_pairs"("id") ON DELETE CASCADE;

-- FK covering indexes (unindexed_foreign_keys advisor convention, per
-- 20260619120100_index_unindexed_fks.sql) on BOTH FK columns — both are ON
-- DELETE CASCADE, so these also accelerate cascade deletes. idx_..._group is
-- somewhat redundant with the UNIQUE(engagement_group_id, q_a_pair_id)
-- constraint's own composite index (whose leading column already covers
-- equality lookups on engagement_group_id alone), but an explicit
-- single-column index is added anyway for parity with the
-- engagement_group_content_q_a_pair_id_fkey side and to match the
-- form_attachments precedent (20260716113306) of one explicit index per FK.
CREATE INDEX "idx_engagement_group_content_group" ON "public"."engagement_group_content" USING "btree" ("engagement_group_id");
CREATE INDEX "idx_engagement_group_content_pair" ON "public"."engagement_group_content" USING "btree" ("q_a_pair_id");

ALTER TABLE "public"."engagement_group_content" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "engagement_group_content_select" ON "public"."engagement_group_content" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "engagement_group_content_insert" ON "public"."engagement_group_content" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "engagement_group_content_update" ON "public"."engagement_group_content" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "engagement_group_content_delete" ON "public"."engagement_group_content" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

GRANT ALL ON TABLE "public"."engagement_group_content" TO "authenticated";
GRANT ALL ON TABLE "public"."engagement_group_content" TO "service_role";
