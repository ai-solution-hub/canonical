-- ID-116.3 — btree indexes for unindexed foreign keys.
--
-- A foreign-key column without a covering index forces a sequential scan on the
-- referencing table whenever the referenced row is updated/deleted (cascade/restrict
-- checks) or joined on the FK. Adding a btree index on each FK column lets those checks
-- and joins use an index scan.
--
-- Addresses 11 live unindexed_foreign_keys INFO advisories (brief listed 9, of which 2
-- were phantom — content_items.parent_id non-existent, q_a_extractions.promoted_to_pair_id
-- already indexed; 4 additional real FKs surfaced by the live advisor included). Verified
-- against canonical-platform on 19/06/2026; FK constraints verified present in the squash
-- baseline (supabase/migrations/20260617130000_squash_baseline.sql).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS for each. Plain CREATE INDEX (transaction-safe,
-- since supabase db push wraps migrations in a txn). NOTE for apply-time: the Orchestrator
-- may convert these to CREATE INDEX CONCURRENTLY if a zero-lock apply on the live prod DB
-- is required — CONCURRENTLY cannot run inside the push transaction and would need an
-- out-of-band apply.

CREATE INDEX IF NOT EXISTS "idx_form_template_requirements_template_type" ON "public"."form_template_requirements" USING "btree" ("template_type");

CREATE INDEX IF NOT EXISTS "idx_intelligence_workspaces_company_profile_id" ON "public"."intelligence_workspaces" USING "btree" ("company_profile_id");

CREATE INDEX IF NOT EXISTS "idx_intelligence_workspaces_guide_id" ON "public"."intelligence_workspaces" USING "btree" ("guide_id");

CREATE INDEX IF NOT EXISTS "idx_procurement_vehicle_instances_vehicle_key" ON "public"."procurement_vehicle_instances" USING "btree" ("vehicle_key");

CREATE INDEX IF NOT EXISTS "idx_q_a_pair_history_changed_by" ON "public"."q_a_pair_history" USING "btree" ("changed_by");

CREATE INDEX IF NOT EXISTS "idx_q_a_pairs_source_workspace_id" ON "public"."q_a_pairs" USING "btree" ("source_workspace_id");

CREATE INDEX IF NOT EXISTS "idx_q_a_pairs_superseded_by" ON "public"."q_a_pairs" USING "btree" ("superseded_by");

CREATE INDEX IF NOT EXISTS "idx_q_a_pairs_source_form_response_id" ON "public"."q_a_pairs" USING "btree" ("source_form_response_id");

CREATE INDEX IF NOT EXISTS "idx_q_a_pairs_source_question_id" ON "public"."q_a_pairs" USING "btree" ("source_question_id");

CREATE INDEX IF NOT EXISTS "idx_question_matches_question_kind" ON "public"."question_matches" USING "btree" ("question_kind");

CREATE INDEX IF NOT EXISTS "idx_tag_morphology_drift_flags_decided_by" ON "public"."tag_morphology_drift_flags" USING "btree" ("decided_by");
