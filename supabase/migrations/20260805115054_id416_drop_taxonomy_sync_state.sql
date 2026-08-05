-- id-416: drop taxonomy_sync_state — the last storage leg of the retired
-- taxonomy-sync MACHINERY (owner ruling S534: retire the machinery; KEEP
-- taxonomy_snapshot.json + the manual `sync:taxonomy` regeneration path).
--
-- The table tracked automated sync runs (last_sync_hash drift marker, callback
-- bookkeeping) for the /api/admin/taxonomy-sync endpoint → repository_dispatch
-- → taxonomy-sync.yml → HMAC callback loop. Every leg of that loop is gone:
-- the admin endpoint + callback route were deleted in the S529 wave
-- (3349ce79f removed their tests), the workflow and its dispatcher
-- (dispatchTaxonomySync, zero production callers) are deleted in this batch,
-- and the kept manual generators never read or write this table (measured:
-- no last_sync_hash / taxonomy_sync_state reader outside the GDPR export legs
-- and seed row trimmed in this same batch).
--
-- api.taxonomy_sync_state is dropped in the same batch (DR-032: the exposure
-- companion never ships as a follow-up). The RLS policies, singleton index,
-- PK and grants fall with the table; no FK or trigger references it
-- (measured against the squash baseline + all later migrations).

DROP VIEW IF EXISTS api.taxonomy_sync_state;

DROP TABLE IF EXISTS public.taxonomy_sync_state;
