-- 20260521203414_t8_op_id_propagation.sql
-- Cocoindex per-flow op_id column propagation + B-tree partial indexes
-- ID-28.5 — PRODUCT Inv-11 (per-row op_id stamping substrate), Inv-12 (op_id round-trip substrate)
-- TECH §P-4 (migration half)
-- ADD COLUMN-only; IF NOT EXISTS-guarded; no PL/pgSQL functions; no destructive operations.

SET search_path = public, extensions;

-- content_items
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_content_items_op_id ON public.content_items (op_id) WHERE op_id IS NOT NULL;
COMMENT ON COLUMN public.content_items.op_id IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';

-- q_a_extractions
ALTER TABLE public.q_a_extractions ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_q_a_extractions_op_id ON public.q_a_extractions (op_id) WHERE op_id IS NOT NULL;
COMMENT ON COLUMN public.q_a_extractions.op_id IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';

-- source_documents
ALTER TABLE public.source_documents ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_source_documents_op_id ON public.source_documents (op_id) WHERE op_id IS NOT NULL;
COMMENT ON COLUMN public.source_documents.op_id IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';

-- pipeline_runs
ALTER TABLE public.pipeline_runs ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_op_id ON public.pipeline_runs (op_id) WHERE op_id IS NOT NULL;
COMMENT ON COLUMN public.pipeline_runs.op_id IS 'Cocoindex per-flow op_id; T8 (docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-4)';
