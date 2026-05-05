// lib/ingest/markdown-batch-schema.ts
//
// EP2 §1.11 markdown-batch UI ingest — Zod schema for the import-phase
// `options` JSON field. Mirrors the `MarkdownBatchOptions` interface
// declared in `lib/ingest/markdown-orchestrator.ts:126`.
//
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §5.2 lines 519-562.
// Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T4 acceptance criterion (f).
//
// CRITICAL: this schema is parsed via `parseBody(BatchOptionsSchema, json)`
// in the route handler — never via inline `.safeParse()` (memory
// `feedback_validation_sweep_safeparse_ban`).
//
// Admin-only fields (`skipDedup` per file, `auto_supersede` per batch) are
// validated here at the type level only. Silent-ignore for non-admin
// callers happens inside the orchestrator (spec §8.2 + memory
// `feedback_classifier_eval_nondeterminism`).

import { z } from 'zod';

/** Per-file override entry. Mirrors `MarkdownPerFileOverride`. */
export const PerFileOverrideSchema = z
  .object({
    /** Filename — must match an entry in the multipart `files[]`. */
    filename: z.string().min(1, 'filename is required'),
    /** Whether to exclude this file from the batch (skipped, not inserted). */
    excluded: z.boolean().optional(),
    /** Override the heuristic. `'final'` → `publication_status='in_review'`. */
    draft_or_final: z.enum(['draft', 'final']).optional(),
    /** Admin-only — silently ignored for editors per spec §8.2. */
    skip_dedup: z.boolean().optional(),
  })
  .strict();

/** Batch-wide options. Mirrors the `batch` block of spec §5.2. */
export const BatchWideOptionsSchema = z
  .object({
    /** Admin-only — silently ignored for editors per spec §5.2. */
    auto_supersede: z.boolean().optional(),
    /** Mirror of Python `--tag`. */
    tag: z.string().optional(),
    /** Mirror of Python `--author`. */
    author: z.string().optional(),
  })
  .strict();

/**
 * Top-level options shape parsed from the multipart `options` field.
 *
 * Note: the route receives this as a JSON string in the form-data; the
 * route handler parses it once with `JSON.parse` and then validates with
 * `parseBody(BatchOptionsSchema, parsed)`.
 */
export const BatchOptionsSchema = z
  .object({
    per_file_overrides: z.array(PerFileOverrideSchema).optional(),
    batch: BatchWideOptionsSchema.optional(),
    /**
     * Pre-generated pipeline_run_id (Pattern E client-UUID flow — S212 W2).
     * The UI generates `crypto.randomUUID()` BEFORE firing the import
     * mutation so polling against `GET /api/pipeline-runs/[id]` can begin
     * immediately. The route forwards this to the orchestrator's
     * `pipelineRunIdOverride` and the orchestrator's at-start INSERT
     * adopts it verbatim. Optional — non-UI callers (e.g. future
     * background-queue worker) can omit and the orchestrator generates
     * one locally.
     */
    pipeline_run_id: z.string().uuid().optional(),
  })
  .strict();

/** @public */
export type BatchOptions = z.infer<typeof BatchOptionsSchema>;
/** @public */
export type PerFileOverride = z.infer<typeof PerFileOverrideSchema>;
/** @public */
export type BatchWideOptions = z.infer<typeof BatchWideOptionsSchema>;
