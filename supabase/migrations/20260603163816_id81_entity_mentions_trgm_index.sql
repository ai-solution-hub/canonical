-- ID-81.4 — pg_trgm re-install + gin_trgm_ops index on entity_mentions.canonical_name
--
-- Backs the Stage-5 existing-canonical seed-roster candidate-prefilter (ID-81 PC-6):
-- _select_existing_canonical_roster() reaches the trigram similarity operator via
-- OPERATOR(extensions.%) to bound the op-agnostic historical roster to canonicals
-- lexically plausible against the in-flight run's names.
--
-- pg_trgm was DROPPED by 20260428122115_relocate_extensions_to_extensions_schema.sql
-- (it had zero in-use indexes; prod never had it). The squash baseline had installed it
-- WITH SCHEMA "public" (20260416102457). Per the relocate migration's deliberate intent,
-- extensions live in the `extensions` schema, never `public` — so this re-install is
-- WITH SCHEMA extensions and the gin_trgm_ops opclass is schema-qualified as
-- extensions.gin_trgm_ops. The asyncpg pool session search_path (flow.py:2547) excludes
-- `extensions`, which is why the reader query qualifies the operator as OPERATOR(extensions.%)
-- rather than relying on a bare `%`.
--
-- DDL-only (no new function) → no SET search_path / REVOKE anon obligation.
-- CLI-applied (supabase db push), staging first then prod under the schema-parity guard.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE INDEX IF NOT EXISTS idx_entity_mentions_canonical_trgm
  ON public.entity_mentions
  USING gin (canonical_name extensions.gin_trgm_ops);
