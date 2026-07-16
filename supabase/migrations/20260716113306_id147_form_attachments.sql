-- ID-147 {147.7} — form_attachments: reference/evidence attachment store (TECH.md §2
-- "Reference/evidence attachment store", DR-068; PRODUCT.md §A5/§A6/§A7).
-- AUTHORED HERE, NOT PUSHED — Lane B2 never pushes migrations; the parent sequences
-- the push AFTER the ID-145 W1 push + type-regen this migration depends on
-- (form_instances, engagement_groups already exist — W1c, 20260712062000).
--
-- Scope: the form OWNS its primary document zero-schema (form_instances.filename /
-- storage_path / mime_type + the existing tender-documents/<form_id>/ storage
-- listing, app/api/procurement/[id]/route.ts) — this table is ONLY for the *added*
-- labelled reference/evidence attachment (a CV) at form OR engagement level (§A6),
-- plus the role='form_source' signed-PDF write target used by the e-signature fill
-- mechanism (§F3).
--
-- §A7 delete semantics fall out of the FKs: a form-level attachment cascades with its
-- form (form_instance_id ON DELETE CASCADE — the form owns it); an engagement-level
-- attachment cascades with its engagement link (engagement_group_id ON DELETE
-- CASCADE). Because form_instances.engagement_group_id is itself ON DELETE SET NULL
-- (W1c STEP 1), deleting an engagement never touches a form or its own documents.
--
-- Storage-object cleanup (the FK CASCADE gap: a Postgres cascade removes the row but
-- cannot reach the Supabase Storage object) is an application-layer concern owned by
-- the {145.19}-wave implementation contract (best-effort remove() in the DELETE path +
-- a periodic orphan-sweep backstop) — out of scope for this migration.
--
-- RLS mirrors the W1c engagement_groups posture (20260712062000 STEP 6) exactly:
-- SELECT for any authenticated member (form-first "any authenticated member may
-- read"); INSERT/UPDATE/DELETE gated on get_user_role() IN ('admin','editor')
-- (§F4/§H3 admin/editor-gated mutation, BI-47); NO anon table grant (the stricter
-- posture engagement_groups uses, not the blanket GRANT ALL ... TO anon
-- capped-by-RLS pattern most sibling tables use). No new functions here, so no
-- search_path / anon-EXECUTE work (DR-035 born-locked applies to functions only).
--
-- Behaviour-first RLS/constraint tests land in the API subtask ({147.8}), not here.
--
-- UK English throughout (DD/MM/YYYY). Authored 16/07/2026.

CREATE TABLE "public"."form_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "form_instance_id" "uuid" REFERENCES "public"."form_instances"("id") ON DELETE CASCADE,
    "engagement_group_id" "uuid" REFERENCES "public"."engagement_groups"("id") ON DELETE CASCADE,
    "role" "text" NOT NULL CHECK (("role" IN ('form_source', 'reference_evidence'))),
    "filename" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "file_size" bigint,
    "created_by" "uuid" REFERENCES "public"."user_profiles"("id"),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "form_attachments_pkey" PRIMARY KEY ("id"),
    -- Exactly one scope is set: a form-level OR an engagement-level attachment (§A6).
    CONSTRAINT "form_attachments_scope_xor" CHECK (
        ((("form_instance_id" IS NOT NULL))::"int" + (("engagement_group_id" IS NOT NULL))::"int") = 1
    ),
    -- A form_source is always form-scoped: an engagement has no form source of its
    -- own, so role='form_source' with only engagement_group_id set is incoherent
    -- (§F3's signed-PDF write targets role='form_source' on a form_instance).
    CONSTRAINT "form_attachments_form_source_scoped" CHECK (
        ("role" = 'reference_evidence') OR ("form_instance_id" IS NOT NULL)
    )
);

ALTER TABLE "public"."form_attachments" OWNER TO "postgres";

COMMENT ON TABLE "public"."form_attachments" IS 'ID-147 {147.7} DR-068/§A5-§A7 — labelled reference/evidence attachment store (a CV, etc.) at form OR engagement level, plus the role=''form_source'' signed-PDF write target (§F3). The form''s OWN primary document stays zero-schema (form_instances.filename/storage_path/mime_type) — this table is for ADDED attachments only.';

-- FK covering indexes (unindexed_foreign_keys advisor convention, per
-- 20260619120100_index_unindexed_fks.sql) on BOTH scope-FK columns — both are
-- ON DELETE CASCADE, so these also accelerate cascade deletes.
CREATE INDEX "idx_form_attachments_form_instance" ON "public"."form_attachments" USING "btree" ("form_instance_id");
CREATE INDEX "idx_form_attachments_engagement" ON "public"."form_attachments" USING "btree" ("engagement_group_id");

-- RLS: mirrors W1c engagement_groups (20260712062000 STEP 6) — SELECT for any
-- authenticated member; INSERT/UPDATE/DELETE admin/editor-gated; NO anon table grant.
ALTER TABLE "public"."form_attachments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "form_attachments_select" ON "public"."form_attachments" FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "form_attachments_insert" ON "public"."form_attachments" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "form_attachments_update" ON "public"."form_attachments" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) WITH CHECK (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));
CREATE POLICY "form_attachments_delete" ON "public"."form_attachments" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'editor'::"text"])));

GRANT ALL ON TABLE "public"."form_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."form_attachments" TO "service_role";
