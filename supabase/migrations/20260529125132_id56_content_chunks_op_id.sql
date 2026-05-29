-- 20260529125132_id56_content_chunks_op_id.sql
-- Cocoindex per-flow op_id column propagation to content_chunks (extends P-4 pattern)
-- ID-56.6 — PRODUCT Inv C-13 (chunk-row op_id NEW required column), C-21 (cross-table run correlation)
-- TECH §2.Y Migration 1 (mirrors supabase/migrations/20260521203414_t8_op_id_propagation.sql)
-- ADD COLUMN-only; IF NOT EXISTS-guarded; no PL/pgSQL functions; no destructive operations.

SET search_path = public, extensions;

-- content_chunks
ALTER TABLE public.content_chunks
  ADD COLUMN IF NOT EXISTS op_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_content_chunks_op_id
  ON public.content_chunks (op_id)
  WHERE op_id IS NOT NULL;
COMMENT ON COLUMN public.content_chunks.op_id IS
  'Cocoindex per-flow op_id stamped by the chunking stage; ID-56.6 (extends docs/specs/cocoindex-flow-scaffolding/TECH.md §P-4 pattern to content_chunks per OQ-CMI-56-1 (c) S276).';
