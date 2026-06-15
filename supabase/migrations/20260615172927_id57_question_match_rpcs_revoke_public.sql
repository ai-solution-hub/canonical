-- =============================================================================
-- ID-57 {57.6}/{57.7} followup — REVOKE EXECUTE FROM PUBLIC on question_match RPCs
-- =============================================================================
-- B7 hardening. CREATE FUNCTION grants EXECUTE to PUBLIC by default (proacl `=X`);
-- anon ∈ PUBLIC inherits it, so REVOKE ... FROM anon alone is a no-op. Must REVOKE
-- FROM PUBLIC. Mirrors reference_search (20260606130224:159-163) and the q_a_search
-- followup (20260521095209). The base RPCs landed in 20260615165758 (already applied);
-- this is a forward-only followup, not an edit of the applied migration.
-- Writer signature is schema-qualified extensions.vector (db push login-role search_path
-- excludes the extensions schema — see 20260615165758 header).
--
-- Apply log:
--   * (this push) — staging (turayklvaunphgbgscat). PROD push GATED — parent sequences.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION
  public.question_match_recompute(uuid, text, extensions.vector, text, text[], text[], integer)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  public.question_match_search(uuid, text, integer)
  FROM PUBLIC;
