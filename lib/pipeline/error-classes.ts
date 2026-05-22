// lib/pipeline/error-classes.ts
//
// Subtask ID-28.13 — Inv-25 6-class stage-level error vocabulary.
//
// Canonical enumeration of the failure categories produced by the
// cocoindex Python pipeline. The vocabulary is STAGE-LEVEL (one class
// per pipeline-stage failure surface) and lives at a different
// abstraction from the pydantic-level sub-classes in
// `scripts/cocoindex_pipeline/extraction.py` (`_PYDANTIC_ERROR_TO_
// ERROR_CLASS` — `missing_required`, `invalid_discriminator`, etc.,
// which are sub-classifications WITHIN `extraction_validation_failed`).
//
// Wire-up:
//   - The Python sidecar (`scripts/cocoindex_pipeline/flow.py`) maps
//     per-stage exceptions to one of these six classes and emits the
//     value as the `errorClass` field of the pipeline-runs webhook
//     payload (P-7).
//   - The Vercel webhook route
//     (`app/api/internal/pipeline-runs/record/route.ts`) consumes the
//     `PipelineErrorClassSchema` to validate the inbound payload at the
//     trust boundary, rejecting unknown classes with HTTP 400.
//   - The validated value lands in
//     `pipeline_runs.result.error_class` (JSONB) so operators can
//     filter persistent failures by stage cause.
//
// References:
//   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-25
//     (verbatim enumeration source).
//   - docs/specs/cocoindex-flow-scaffolding/TECH.md §P-8 (failure-mode
//     wiring; sidecar emission contract).
//
// CLAUDE.md gotcha: this module does NOT re-export anything from a
// barrel `index.ts`. Callers import direct: `@/lib/pipeline/error-
// classes`.

import { z } from 'zod';

/**
 * The 6-class stage-level error vocabulary (PRODUCT Inv-25).
 *
 * Each member identifies the pipeline stage whose failure surfaced the
 * exception:
 *
 * - `extraction_validation_failed` — Pydantic validation rejected the
 *   LLM response (sub-classified further by
 *   `_PYDANTIC_ERROR_TO_ERROR_CLASS` in the Python extractor).
 * - `extraction_provider_unavailable` — Anthropic / LiteLLM 5xx exhaust
 *   after cocoindex retry budget.
 * - `postgres_write_failed` — `asyncpg.PostgresError` from
 *   `mount_table_target` UPSERT.
 * - `binary_conversion_failed` — Docling raised on PDF / DOCX / XLSX
 *   conversion (Stage 2 adapter).
 * - `embedding_failed` — LiteLLMEmbedder failed (Stage 4 — landing
 *   surface, currently stub).
 * - `entity_resolution_failed` — entity_resolution function raised
 *   (Stage 5 — landing surface, currently stub).
 */
export const PIPELINE_ERROR_CLASSES = [
  'extraction_validation_failed',
  'extraction_provider_unavailable',
  'postgres_write_failed',
  'binary_conversion_failed',
  'embedding_failed',
  'entity_resolution_failed',
] as const;

/**
 * TypeScript literal-union type for an Inv-25 stage-level error class.
 *
 * Discriminant suitable for `switch` exhaustiveness in failure-routing
 * code on either side of the webhook boundary.
 */
export type PipelineErrorClass = (typeof PIPELINE_ERROR_CLASSES)[number];

/**
 * Zod schema for runtime validation of an Inv-25 stage-level error
 * class.
 *
 * Used by the Vercel webhook route to gate inbound `errorClass` strings
 * at the trust boundary. Unknown classes fail with HTTP 400 — there is
 * no fallback `unknown` member, because the Python sidecar is the only
 * legitimate emitter and it is required to map every exception to one
 * of the six canonical classes.
 */
export const PipelineErrorClassSchema = z.enum(PIPELINE_ERROR_CLASSES);
