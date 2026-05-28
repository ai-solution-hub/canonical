// Inv-25 — canonical 6-class stage-level error vocabulary for the
// cocoindex Python pipeline. Distinct from the pydantic-level sub-classes
// in `_PYDANTIC_ERROR_TO_ERROR_CLASS` (extraction.py) which sit
// WITHIN `extraction_validation_failed`.
//
// Wire-up: Python sidecar emits as the `errorClass` field of the
// pipeline-runs webhook; Vercel route gates inbound values via the Zod
// schema (HTTP 400 on unknown). Validated value lands in
// `pipeline_runs.result.error_class` (JSONB).
//
// References:
//   docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-25.
//   docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-8.

import { z } from 'zod';

/**
 * The 6-class stage-level error vocabulary (Inv-25):
 *
 * - `extraction_validation_failed` — Pydantic rejected LLM response.
 * - `extraction_provider_unavailable` — Anthropic/LiteLLM 5xx exhaust.
 * - `postgres_write_failed` — `asyncpg.PostgresError` on UPSERT.
 * - `binary_conversion_failed` — Docling raised (Stage 2).
 * - `embedding_failed` — LiteLLMEmbedder raised (Stage 4; stub).
 * - `entity_resolution_failed` — entity_resolution raised (Stage 5; stub).
 */
export const PIPELINE_ERROR_CLASSES = [
  'extraction_validation_failed',
  'extraction_provider_unavailable',
  'postgres_write_failed',
  'binary_conversion_failed',
  'embedding_failed',
  'entity_resolution_failed',
] as const;

export type PipelineErrorClass = (typeof PIPELINE_ERROR_CLASSES)[number];

/**
 * Zod schema for trust-boundary validation. No `unknown` fallback —
 * the sidecar is the only legitimate emitter, required to map every
 * exception to one of the 6 canonical classes.
 */
export const PipelineErrorClassSchema = z.enum(PIPELINE_ERROR_CLASSES);
