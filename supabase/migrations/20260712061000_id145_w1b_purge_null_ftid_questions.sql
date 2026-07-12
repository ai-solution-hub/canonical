-- ID-145 {145.6} W1b — purge NULL-form_template_id form_questions debris.
-- TECH.md §2 M2; R3 (no backfill, no "unassigned" sentinel). 119 debris rows on
-- staging. MUST precede W1c's `form_instance_id SET NOT NULL` — that constraint
-- cannot be added while any row is still NULL. Idempotent — a re-run against an
-- already-purged table deletes zero rows.
DELETE FROM "public"."form_questions" WHERE "form_template_id" IS NULL;
