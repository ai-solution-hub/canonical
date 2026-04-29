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
 * Per-file failure record returned in import-phase summary.
 */
export interface MarkdownImportFailure {
  filename: string;
  reason: string;
}

/**
 * Import-phase summary returned to the route handler.
 *
 * Note: spec §5.4 enumerates a richer shape (stored / dedup_flagged /
 * superseded / skipped_excluded / errored). The orchestrator surfaces the
 * compact contract from the W1-T2 prompt — `created` / `skipped` / `failed`
 * — and stamps the rich shape onto `pipeline_runs.result` for dashboard view.
 * The route layer (T3) shapes the HTTP response further if needed.
 */
export interface MarkdownBatchResultsSummary {
  created: string[];
  skipped: string[];
  failed: MarkdownImportFailure[];
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
