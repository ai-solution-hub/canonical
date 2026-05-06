// types/ingest.ts
//
// EP2 §1.11 markdown-batch UI ingest — public type contracts.
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 (§4.2 analyse,
//   §4.4 import, §5.4 response shape).
// Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T2 types module).
//
// Re-homed from `lib/ingest/markdown-orchestrator.ts` so the route handler,
// orchestrator, and any future background-queue worker can share a single
// type surface without coupling on the orchestrator implementation file.
// The orchestrator continues to re-export these types for backwards
// compatibility with consumers that reach in via `@/lib/ingest/markdown-orchestrator`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/** One file submitted to the orchestrator. */
export interface MarkdownIngestFile {
  filename: string;
  /** Raw UTF-8 markdown body — already decoded by the route handler. */
  content: string;
  /** Optional file size in bytes; used only for analysis result reporting. */
  sizeBytes?: number;
}

/** Per-file overrides supplied at import time (route forwards from request). */
export interface MarkdownPerFileOverride {
  filename: string;
  excluded?: boolean;
  draftOrFinal?: 'draft' | 'final';
  /** Admin-only — silently ignored for non-admin callers per spec §8.2. */
  skipDedup?: boolean;
}

export interface MarkdownBatchOptions {
  perFileOverrides?: MarkdownPerFileOverride[];
  /** Mirror of Python `--tag`. Optional; not used by analyse phase. */
  tag?: string | null;
  /** Mirror of Python `--author`. Optional. */
  author?: string | null;
  /** Admin-only override — caller's resolved content_owner_id default. */
  contentOwnerIdOverride?: string | null;
  /**
   * Admin-only — auto-supersede heuristic match. Currently forwarded as
   * no-op until orchestrator wires `setSupersession` in §1.11 EP2 Phase 2.
   * Silently ignored for non-admin callers per spec §5.2.
   */
  autoSupersede?: boolean;
  /**
   * Pre-generated pipeline_run_id (Pattern E client-UUID flow — S212 W2).
   * When provided, the orchestrator adopts this id verbatim on the at-start
   * INSERT so the calling client can begin polling
   * `GET /api/pipeline-runs/[id]` immediately after firing the mutation.
   * When absent (any non-UI caller — e.g. future background-queue worker),
   * the orchestrator generates one locally via `randomUUID()`.
   */
  pipelineRunIdOverride?: string | null;
  /**
   * Optional cooperative-cancel poll callback (S226 §5.4.4 W1-IMPL).
   * Invoked BEFORE each file in the per-file loop (cadence=1 per
   * `docs/specs/§5.4.4-ep2-markdown-batch-migration-spec.md` §10 D-8
   * ratified flip). Returning `true` stops the loop after the previous
   * file boundary; the orchestrator records the partial outcome envelope
   * and finalises `pipeline_runs` with the in-flight counts.
   * When omitted (default for non-queued callers — sync route, future
   * cron Python jobs), the orchestrator never polls; behaviour is
   * verbatim with pre-S226. Pattern E mid-flight progress writes are
   * preserved per D-10 RATIFIED.
   */
  cancelCheck?: () => Promise<boolean>;
}

/**
 * Per-file pre-flight analysis result. Mirrors spec §4.2 response shape.
 * Returned by phase='analyse'; consumed by the route's response and by the
 * UI analysis table.
 */
export interface MarkdownIngestAnalysis {
  filename: string;
  sizeBytes: number;
  encodingOk: boolean;
  empty: boolean;
  frontMatter: {
    present: boolean;
    parsedOk: boolean;
    error?: string;
    fields: Record<string, unknown>;
  };
  title: string;
  titleProvenance: 'front-matter' | 'h1' | 'bold-after-article-n' | 'filename';
  contentHash: string;
  hasConflictMarkers: boolean;
  diffMarkers: {
    gitConflictCount: number;
    plusMinusLineCount: number;
    warning: boolean;
  };
  draftOrFinalHeuristic: 'draft' | 'final' | 'unknown';
  /** Outcome of `checkExactDuplicate` against existing content_items. */
  dedupVerdict: {
    isDuplicate: boolean;
    existingId?: string;
    existingTitle?: string;
  };
  /** Filename-based existing match (Python `--skip-existing` parity). */
  sourceFileMatch: { id: string; title: string } | null;
  /** Per-file pre-flight error (e.g. encoding/parsing) — does NOT abort batch. */
  error?: string;
}

/**
 * Per-file error record returned in import-phase summary.
 * Mirrors spec §5.4 `errored: Array<{ filename: string; error: string }>`.
 */
export interface MarkdownImportError {
  filename: string;
  error: string;
}

/**
 * Import-phase summary returned to the route handler.
 *
 * Mirrors spec §5.4 verbatim — the same shape is also stamped onto
 * `pipeline_runs.result` so the dashboard view + late-arriving pollers can
 * read it.
 */
export interface MarkdownBatchResultsSummary {
  files_processed: number;
  stored: Array<{ id: string; title: string; filename: string }>;
  dedup_flagged: Array<{
    id: string;
    title: string;
    filename: string;
    suspected_duplicate_of: string;
  }>;
  superseded: Array<{ new_id: string; old_id: string; filename: string }>;
  skipped_excluded: string[];
  errored: MarkdownImportError[];
}

export type MarkdownAnalysePhaseResult = {
  analysis: MarkdownIngestAnalysis[];
};

export type MarkdownImportPhaseResult = {
  pipeline_run_id: string;
  results_summary: MarkdownBatchResultsSummary;
};

export interface MarkdownAnalysePhaseParams {
  phase: 'analyse';
  files: MarkdownIngestFile[];
  supabase: SupabaseClient<Database>;
}

export interface MarkdownImportPhaseParams {
  phase: 'import';
  files: MarkdownIngestFile[];
  supabase: SupabaseClient<Database>;
  /** Caller user ID — owner of the records being created. */
  callerUserId: string;
  /** 'admin' | 'editor' — controls skip_dedup + admin override gating. */
  callerRole: 'admin' | 'editor';
  options?: MarkdownBatchOptions;
}

export type MarkdownOrchestratorParams =
  | MarkdownAnalysePhaseParams
  | MarkdownImportPhaseParams;
