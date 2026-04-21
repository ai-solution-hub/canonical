-- Drop acquire_taxonomy_sync_lock() function — not needed under Option E
-- Spec §4.3: "The original spec included an acquire_taxonomy_sync_lock RPC
-- function for advisory locking. This is not needed under Option E."
-- Concurrency is handled by GitHub Actions concurrency.group + client-side debounce.

DROP FUNCTION IF EXISTS public.acquire_taxonomy_sync_lock();
