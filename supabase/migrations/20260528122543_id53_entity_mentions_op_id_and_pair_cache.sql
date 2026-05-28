-- ID-53 — Stage-5 entity-resolution: op_id on entity_mentions + PairResolver cache.
-- Spec: docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-9.
-- Ratification:
--   - PRODUCT.md Inv-6 / Inv-7 — op_id round-trip + memo-respecting semantic.
--   - PRODUCT.md Inv-14 + §5 P-OQ3 — entity_pair_resolutions cache table shape.
--   - RESEARCH.md §R6.2 — op_id migration SQL (verbatim).
--   - S273 OQ-2 — entity_mentions op_id gap (folded into ID-53 per Liam ruling).
-- Mirrors T8 pattern at supabase/migrations/20260521203414_t8_op_id_propagation.sql.
-- Idempotency: IF NOT EXISTS guards so re-apply is no-op.
-- DDL via Supabase CLI ONLY (supabase migration new + db push); NEVER MCP
-- execute_sql / apply_migration (CLAUDE.md gotcha "DDL via CLI only").

SET search_path = public, extensions;

-- 1. entity_mentions.op_id (S273 OQ-2 ruling; ID-53 spec rescope).
--    NULL-default; existing rows stay NULL until backfilled OR re-ingested.
--    Stage-5 post-pass (§P-6) UPDATEs are op_id-scoped — NULL-op_id rows
--    are READ for resolution input but NEVER UPDATED (Inv-5).
ALTER TABLE public.entity_mentions
  ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_entity_mentions_op_id
  ON public.entity_mentions (op_id) WHERE op_id IS NOT NULL;

COMMENT ON COLUMN public.entity_mentions.op_id IS
  'KH-generated per-run op_id, written as a declare_row field at UPSERT '
  'time per N7 hybrid (02-data-flow.md §5). Round-trip: pipeline_runs.op_id. '
  'Required for Stage-5 op_id-scoped UPDATEs per PRODUCT.md Inv-5. '
  'Mirrors T8 pattern at 20260521203414_t8_op_id_propagation.sql.';

-- 2. entity_pair_resolutions — PairResolver determinism cache (Inv-14).
--    P-OQ3 resolution: new table (NOT extending entity_aliases, NOT in-memory).
--    name_a / name_b lexicographically ordered by the resolver at insert
--    time so (a,b) and (b,a) hit the same row. UNIQUE constraint on the
--    pair triple is the cache key; op_id audits which run originated the
--    decision.
CREATE TABLE IF NOT EXISTS public.entity_pair_resolutions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name_a        text NOT NULL,
    name_b        text NOT NULL,
    entity_type   text NOT NULL,
    decision      text NOT NULL CHECK (decision IN ('same', 'different')),
    resolved_at   timestamptz NOT NULL DEFAULT now(),
    op_id         uuid NULL,
    CONSTRAINT entity_pair_resolutions_pair_unique UNIQUE (name_a, name_b, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_entity_pair_resolutions_op_id
  ON public.entity_pair_resolutions (op_id) WHERE op_id IS NOT NULL;

COMMENT ON TABLE public.entity_pair_resolutions IS
  'PairResolver determinism cache for Stage-5 cocoindex.resolve_entities. '
  'PRODUCT.md Inv-14 + §5 P-OQ3. Lexicographic ordering of (name_a, name_b) '
  'at insert time ensures cache-key stability; UNIQUE constraint backs the '
  'cache lookup. op_id records the originating run for audit-forensics.';

COMMENT ON COLUMN public.entity_pair_resolutions.name_a IS
  'Lexicographically smaller of the (entity, candidate) pair at insert time.';
COMMENT ON COLUMN public.entity_pair_resolutions.name_b IS
  'Lexicographically larger of the (entity, candidate) pair at insert time.';
COMMENT ON COLUMN public.entity_pair_resolutions.decision IS
  'Resolver decision: same | different. Checked at LOAD time by KhPairResolver.';
COMMENT ON COLUMN public.entity_pair_resolutions.op_id IS
  'op_id of the run that originated this decision (NULL if backfilled).';
