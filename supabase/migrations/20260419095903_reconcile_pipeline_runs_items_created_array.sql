-- Reconcile pipeline_runs.items_created type drift.
-- OLD production: items_created uuid[] (array of UUIDs created this run)
-- NEW post-squash: items_created integer (count)
-- Code (app/api/items/batch/route.ts, components/provenance/...) uses it as
-- a UUID array. Table is empty on new project; drop + re-add as uuid[].

ALTER TABLE public.pipeline_runs DROP COLUMN items_created;
ALTER TABLE public.pipeline_runs ADD COLUMN items_created uuid[];
