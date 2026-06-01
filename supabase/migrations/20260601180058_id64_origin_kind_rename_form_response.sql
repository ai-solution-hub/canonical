-- ID-64.2 (S296) — origin_kind value rename: derived_from_bid_response -> derived_from_form_response.
--
-- RESEARCH §3. origin_kind is a TEXT column governed by a CHECK constraint (NOT a pg ENUM).
-- The live CHECK exists ONLY on public.q_a_pairs (q_a_pairs_origin_kind_check); q_a_pair_history
-- has the origin_kind column but NO CHECK constraint (verified prod pg_constraint, S296), so it
-- already accepts the renamed value — nothing to alter there. Both tables are 0 rows (verified
-- S296), so the DROP+ADD is backfill-free. No Python/TS literal consumes 'derived_from_bid_response'
-- (grep scripts/ lib/ types/, S296 — only historical migration files reference it), so there is
-- no in-lockstep code change.
--
-- Pre-re-ingest readiness gate A2: this MUST land before the corpus writes any derived_from_* row.
-- The DEFAULT ('curated_explicit', set in t6) is unaffected (still valid in the renamed set).
-- NB: the bid_responses TABLE, the search_for_bid_response RPC, and the T11 citing_entity enum
-- value 'bid_response' are a SEPARATE, deferred terminology migration (OQ-64-3) — deliberately
-- OUT of scope here.

ALTER TABLE public.q_a_pairs DROP CONSTRAINT IF EXISTS q_a_pairs_origin_kind_check;

ALTER TABLE public.q_a_pairs ADD CONSTRAINT q_a_pairs_origin_kind_check
  CHECK (origin_kind IN (
    'extracted_from_corpus',
    'curated_explicit',
    'derived_from_form_response',
    'imported_legacy'
  ));
