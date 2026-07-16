-- ID-132.40 (bl-458, owner-ratified DR-060, S469 OQ-MD-2)
-- entity_mentions / entity_relationships: add updated_at + BEFORE UPDATE trigger.
-- Reuses the existing generic public.update_updated_at_column() trigger fn
-- (defined in the 20260617130000 squash baseline, already wired to
-- company_profiles/content_items/eval_touchpoints/feed_articles/feed_sources/
-- form_questions/form_responses/governance_config/workspaces/reference_items/
-- review_assignments/form_template_fields/form_template_requirements/
-- form_templates/user_roles) rather than defining a new one.
--
-- Downstream: {132.38} MEMO-DELTA content_version aggregate consumes
-- count + max(updated_at) over these tables.

-- entity_mentions -------------------------------------------------------

ALTER TABLE "public"."entity_mentions"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL;

COMMENT ON COLUMN "public"."entity_mentions"."updated_at" IS 'Last-modified timestamp, bumped by set_entity_mentions_updated_at BEFORE UPDATE trigger. Backfilled from created_at at migration time ({132.40}, bl-458/DR-060).';

-- Backfill pre-existing rows: updated_at = created_at (COALESCE guards the
-- theoretical NULL created_at case, since created_at carries no NOT NULL
-- constraint on this table).
UPDATE "public"."entity_mentions"
  SET "updated_at" = COALESCE("created_at", "updated_at")
  WHERE "updated_at" IS DISTINCT FROM COALESCE("created_at", "updated_at");

DROP TRIGGER IF EXISTS "set_entity_mentions_updated_at" ON "public"."entity_mentions";
CREATE TRIGGER "set_entity_mentions_updated_at"
  BEFORE UPDATE ON "public"."entity_mentions"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();

-- entity_relationships ---------------------------------------------------

ALTER TABLE "public"."entity_relationships"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL;

COMMENT ON COLUMN "public"."entity_relationships"."updated_at" IS 'Last-modified timestamp, bumped by set_entity_relationships_updated_at BEFORE UPDATE trigger. Backfilled from created_at at migration time ({132.40}, bl-458/DR-060).';

UPDATE "public"."entity_relationships"
  SET "updated_at" = COALESCE("created_at", "updated_at")
  WHERE "updated_at" IS DISTINCT FROM COALESCE("created_at", "updated_at");

DROP TRIGGER IF EXISTS "set_entity_relationships_updated_at" ON "public"."entity_relationships";
CREATE TRIGGER "set_entity_relationships_updated_at"
  BEFORE UPDATE ON "public"."entity_relationships"
  FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();
