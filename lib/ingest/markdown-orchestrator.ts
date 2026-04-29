// lib/ingest/markdown-orchestrator.ts
//
// EP2 §1.11 markdown-batch UI ingest — two-phase orchestrator.
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 (§4.2 analyse,
//   §4.4 import, §5.4 response shape, §7.3 INSERT, §8 dedup).
// Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T3 orchestrator row).
//
// Two phases:
//   - 'analyse'  → READ-ONLY pre-flight: parse FM, clean MDX, extract title,
//                  detect diff markers, detect draft/final, run dedup checks
//                  (content-hash + source_file). NO DB writes. Returns one
//                  `MarkdownIngestAnalysis` per file.
//   - 'import'   → FULL pipeline: per-file pipeline + pipeline_runs row.
//                  INSERT content_items (with `ingest_source: 'upload'` so the
//                  deferred trigger `ensure_v1_history_at_commit` writes the
//                  v1 content_history row with `change_reason='initial_ingest'`
//                  per spec §7.6 G17 + memory feedback_content_history_change_reason_mandatory),
//                  classify, embed, regenerate chunks. Returns
//                  `{ pipeline_run_id, results_summary }`.
//
// Pure-function design (no auth, no req parsing) — the route handler T3 owns
// auth + multipart parsing + maxDuration scoping, and delegates to this
// orchestrator. This separation keeps the orchestrator unit-testable with
// mocked supabase + lets a future background-queue worker (post-§5.4) invoke
// the same orchestrator without route surface coupling. Mirrors the
// `lib/bid-library-ingest/` factor-out pattern.
//
// Gotchas honoured:
// - G3 / feedback_content_text_hash_generated_always: `content_text_hash` is
//   GENERATED ALWAYS — OMITTED from every INSERT payload.
// - G5 / feedback_content_history_change_reason_mandatory: v1 history row is
//   written by the deferred trigger when `ingest_source` is set on insert; we
//   never write content_history directly. Trigger emits
//   `change_reason='initial_ingest'`.
// - G6 / CLAUDE.md "Cron pipeline_runs inserts": we mirror the
//   `recordPipelineRun()` semantics inline (sb() + Sentry capture) because the
//   helper does not return the inserted row's id, but the orchestrator must
//   surface `pipeline_run_id` to the caller per spec §5.4. The pipeline_runs
//   row carries the same fields (status / items_processed / items_created /
//   pipeline_name / result / error_message) as the helper would write.
// - G8 / CLAUDE.md embedding vector serialisation: `JSON.stringify(embedding)`
//   on the `embedding` column write.
// - G17 / spec §7.6: `ingest_source: 'upload'` on every content_items insert
//   — without it the trigger emits the legacy `'auto_v1_on_insert'` reason.
// - D-A guard / spec §7.3 + plan EP2-T3(b): `publication_status` is set
//   EXPLICITLY in the INSERT — never relying on the column DEFAULT
//   (`'published'`).

import * as Sentry from '@sentry/nextjs';
import { randomUUID, createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/supabase/types/database.types';
import { sb, SupabaseError } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  checkExactDuplicate,
  resolveDedupStamp,
  normaliseTextForHash,
} from '@/lib/dedup';
import { resolveContentOwnerId } from '@/lib/auth/owner-default';
import { classifyContent } from '@/lib/ai/classify';
import { generateEmbedding } from '@/lib/ai/embed';
import { regenerateChunks } from '@/lib/content/chunk-store';
import { parseMarkdownFrontMatter } from '@/lib/extraction/markdown-front-matter';
import { extractMarkdownTitle } from '@/lib/extraction/markdown-title';
import { cleanMdxTags } from '@/lib/extraction/clean-mdx-tags';
import { detectDiffMarkers } from '@/lib/extraction/diff-markers';
import { detectDraftFinalFromFilename } from '@/lib/ingest/draft-final-heuristic';
import { draftFinalToPublicationStatus } from '@/lib/ingest/draft-final-to-publication-status';
import type {
  MarkdownIngestFile,
  MarkdownPerFileOverride,
  MarkdownAnalysePhaseParams,
  MarkdownAnalysePhaseResult,
  MarkdownImportPhaseParams,
  MarkdownImportPhaseResult,
  MarkdownIngestAnalysis,
  MarkdownImportFailure,
  MarkdownOrchestratorParams,
} from '@/types/ingest';

// Re-export the public type surface so existing consumers that reach in via
// `@/lib/ingest/markdown-orchestrator` continue to compile. The canonical
// home for these types is now `@/types/ingest`.
export type {
  MarkdownIngestFile,
  MarkdownPerFileOverride,
  MarkdownBatchOptions,
  MarkdownIngestAnalysis,
  MarkdownImportFailure,
  MarkdownBatchResultsSummary,
  MarkdownAnalysePhaseResult,
  MarkdownImportPhaseResult,
  MarkdownAnalysePhaseParams,
  MarkdownImportPhaseParams,
  MarkdownOrchestratorParams,
} from '@/types/ingest';

// W1 wave note: the four `lib/extraction/markdown-*` modules above are owned
// by sibling W1-T1 agent. While that agent ships in parallel, this orchestrator
// commits *minimal stubs* for those four files (with the exact public types
// the spec §3.4 enumerates) so this file compiles + the unit tests pass via
// `vi.mock`. T1's branch contains the real implementations — when both W1
// branches merge in W2, T1's commits TAKE PRECEDENCE for those files (the
// stubs here are placeholder-only). Cherry-pick order: T2 (this branch) first
// for the orchestrator + stub set, then T1 to overwrite the stubs with the
// real impls. Either order works for git, since T1 only ever writes those
// four files.

interface T1Helpers {
  parseMarkdownFrontMatter: typeof parseMarkdownFrontMatter;
  extractMarkdownTitle: typeof extractMarkdownTitle;
  cleanMdxTags: typeof cleanMdxTags;
  detectDiffMarkers: typeof detectDiffMarkers;
}

// Loader kept as a function (not inline imports) so the orchestrator presents
// a single seam for tests to swap T1 helpers via the imported module mocks.
function loadT1Helpers(): T1Helpers {
  return {
    parseMarkdownFrontMatter,
    extractMarkdownTitle,
    cleanMdxTags,
    detectDiffMarkers,
  };
}

/** Service-account UUID for classifier identity (CLAUDE.md gotcha + G2). */
const SERVICE_ACCOUNT_UUID = 'a0000000-0000-4000-8000-000000000001';

/** Pipeline name written to `pipeline_runs.pipeline_name` (spec §5.2 line 559). */
const PIPELINE_NAME = 'upload_markdown_batch';

// Public types live in `@/types/ingest` and are re-exported above for back-compat.

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/**
 * Run the markdown-batch orchestrator.
 *
 * @param params Discriminated union — `phase: 'analyse' | 'import'`.
 * @returns
 *   - `phase: 'analyse'` → `{ analysis: MarkdownIngestAnalysis[] }`
 *   - `phase: 'import'`  → `{ pipeline_run_id, results_summary }`
 */
export async function orchestrateMarkdownBatch(
  params: MarkdownAnalysePhaseParams,
): Promise<MarkdownAnalysePhaseResult>;
export async function orchestrateMarkdownBatch(
  params: MarkdownImportPhaseParams,
): Promise<MarkdownImportPhaseResult>;
export async function orchestrateMarkdownBatch(
  params: MarkdownOrchestratorParams,
): Promise<MarkdownAnalysePhaseResult | MarkdownImportPhaseResult> {
  if (params.phase === 'analyse') {
    return runAnalysePhase(params);
  }
  return runImportPhase(params);
}

// ────────────────────────────────────────────────────────────────────────
// Analyse phase — read-only
// ────────────────────────────────────────────────────────────────────────

async function runAnalysePhase(
  params: MarkdownAnalysePhaseParams,
): Promise<MarkdownAnalysePhaseResult> {
  const { files, supabase } = params;
  const t1 = loadT1Helpers();

  const analyses: MarkdownIngestAnalysis[] = [];

  for (const file of files) {
    analyses.push(await analyseFile(file, supabase, t1));
  }

  return { analysis: analyses };
}

async function analyseFile(
  file: MarkdownIngestFile,
  supabase: SupabaseClient<Database>,
  t1: T1Helpers,
): Promise<MarkdownIngestAnalysis> {
  const { filename, content } = file;
  const sizeBytes = file.sizeBytes ?? Buffer.byteLength(content, 'utf8');

  // Trivial empty / whitespace check up-front (spec §4.3 auto-exclude rules).
  const trimmed = content.trim();
  const isEmpty = trimmed.length === 0;

  // Per spec §4.2: encoding_ok signals a UTF-8 round-trip success. Server
  // already passed us a string, so we report true; route handler is
  // responsible for catching upstream decode failures and reporting them as
  // a per-file error in the analysis array.
  const encodingOk = true;

  // Front-matter parse — never throws; carries error string on malformed YAML.
  const fmResult = t1.parseMarkdownFrontMatter(content);
  const frontMatterFields = fmResult.frontMatter ?? {};
  const frontMatterPresent = fmResult.frontMatter !== null;
  const frontMatterParsedOk = !fmResult.error;

  // Clean MDX tags → cleaned body fed to title extractor + dedup.
  const cleanedBody = t1.cleanMdxTags(fmResult.body);

  // Empty-after-cleanup (spec §4.3) — auto-exclude on import.
  const emptyAfterCleanup = cleanedBody.trim().length === 0;

  // Title extraction — front-matter > H1 > bold-after-Article-N > filename.
  const titleResult = t1.extractMarkdownTitle({
    frontMatter: fmResult.frontMatter,
    body: cleanedBody,
    filename,
  });

  // Diff-marker scan (spec §8.3). Best-effort, warn-only.
  const diffMarkers = t1.detectDiffMarkers(cleanedBody);
  const hasConflictMarkers = diffMarkers.warning;

  // Draft/final filename heuristic (spec §9.1). Front-matter status overrides
  // are applied at import-time per spec §9.1; analyse-phase reports filename
  // heuristic only so the user can see it in the table.
  const draftOrFinalHeuristic = detectDraftFinalFromFilename(filename);

  // content_text_hash equivalent — md5 of normalised cleaned body, used by
  // the dedup gate. We compute it here for the analysis surface so the UI
  // can show the hash if useful for debugging.
  const normalised = normaliseTextForHash(cleanedBody);
  const contentHash = normalised
    ? createHash('md5').update(normalised).digest('hex')
    : '';

  // Per-file dedup gate — read-only. Returns first exact-hash match.
  const dedupVerdict = await checkExactDuplicate(supabase, cleanedBody);

  // Filename-based dedup (Python `--skip-existing` parity). Best-effort —
  // a query failure here MUST NOT abort the analyse phase.
  let sourceFileMatch: { id: string; title: string } | null = null;
  try {
    const result = await supabase
      .from('content_items')
      .select('id, title')
      .eq('source_file', filename)
      .limit(1)
      .maybeSingle();
    if (result.error) {
      logBestEffortWarn(
        'upload_markdown_batch.analyse.source_file_lookup',
        `source_file lookup failed for ${filename}`,
        { filename, error: result.error.message },
      );
    } else if (result.data) {
      sourceFileMatch = {
        id: result.data.id,
        title: result.data.title ?? 'Untitled',
      };
    }
  } catch (err) {
    logBestEffortWarn(
      'upload_markdown_batch.analyse.source_file_lookup',
      `source_file lookup threw for ${filename}`,
      { filename, error: err instanceof Error ? err.message : String(err) },
    );
  }

  return {
    filename,
    sizeBytes,
    encodingOk,
    empty: isEmpty || emptyAfterCleanup,
    frontMatter: {
      present: frontMatterPresent,
      parsedOk: frontMatterParsedOk,
      error: fmResult.error,
      fields: frontMatterFields,
    },
    title: titleResult.title,
    titleProvenance: titleResult.provenance,
    contentHash,
    hasConflictMarkers,
    diffMarkers: {
      gitConflictCount: diffMarkers.gitConflictCount,
      plusMinusLineCount: diffMarkers.plusMinusLineCount,
      warning: diffMarkers.warning,
    },
    draftOrFinalHeuristic,
    dedupVerdict: {
      isDuplicate: dedupVerdict.isDuplicate,
      existingId: dedupVerdict.existingId,
      existingTitle: dedupVerdict.existingTitle,
    },
    sourceFileMatch,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Import phase — full pipeline + pipeline_runs row
// ────────────────────────────────────────────────────────────────────────

async function runImportPhase(
  params: MarkdownImportPhaseParams,
): Promise<MarkdownImportPhaseResult> {
  const { files, supabase, callerUserId, callerRole, options } = params;
  const t1 = loadT1Helpers();

  // Pre-generate the pipeline_runs.id so we can return it to the caller and
  // also write it onto the row (single insert, no select-back round-trip).
  const pipelineRunId = randomUUID();
  const startedAt = new Date().toISOString();

  // Resolve the owner ID once for the batch — admin override applies to every
  // row in the batch (spec §7.3 + lib/auth/owner-default.ts silent-force).
  const ownerId = resolveContentOwnerId({
    explicit: options?.contentOwnerIdOverride ?? null,
    role: callerRole,
    userId: callerUserId,
  });

  const overridesByFilename = new Map<string, MarkdownPerFileOverride>();
  for (const o of options?.perFileOverrides ?? []) {
    overridesByFilename.set(o.filename, o);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const failed: MarkdownImportFailure[] = [];
  // Detailed shape stamped onto pipeline_runs.result for dashboard view.
  const detailedStored: Array<{
    id: string;
    title: string;
    filename: string;
  }> = [];
  const detailedDedupFlagged: Array<{
    id: string;
    title: string;
    filename: string;
    suspected_duplicate_of: string;
  }> = [];

  for (const file of files) {
    const override = overridesByFilename.get(file.filename);

    // Per-row exclusion — listed in skipped, no DB writes.
    if (override?.excluded) {
      skipped.push(file.filename);
      continue;
    }

    try {
      const outcome = await importOneFile({
        file,
        supabase,
        ownerId,
        author: options?.author ?? null,
        callerRole,
        override,
        t1,
      });
      created.push(outcome.id);
      detailedStored.push({
        id: outcome.id,
        title: outcome.title,
        filename: file.filename,
      });
      if (outcome.suspectedDuplicateOf) {
        detailedDedupFlagged.push({
          id: outcome.id,
          title: outcome.title,
          filename: file.filename,
          suspected_duplicate_of: outcome.suspectedDuplicateOf,
        });
      }
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : `Unknown error: ${String(err)}`;
      failed.push({ filename: file.filename, reason });
      // Best-effort breadcrumb so a per-file failure surfaces alongside the
      // summary Sentry alert below.
      logBestEffortWarn(
        'upload_markdown_batch.import.file_failed',
        `Markdown import failed for ${file.filename}`,
        { filename: file.filename, reason },
      );
    }
  }

  const attemptedCount = files.length - skipped.length;
  const status = computeRunStatus({
    failedCount: failed.length,
    createdCount: created.length,
    attemptedCount,
  });

  const errorMessage =
    failed.length > 0
      ? `${failed.length}/${attemptedCount} files failed`
      : null;

  // Build the rich result shape stamped onto pipeline_runs.result. This
  // matches spec §5.4 results_summary shape so the dashboard view + late
  // pollers can read it. Cast via `unknown` because Json's index-signature
  // requirement does not match our nominal MarkdownImportFailure interface,
  // even though the runtime payload is safely JSON-serialisable.
  const resultPayload = {
    files_processed: files.length,
    stored: detailedStored,
    dedup_flagged: detailedDedupFlagged,
    superseded: [] as never[],
    skipped_excluded: skipped,
    errored: failed,
  } as unknown as Json;

  // Insert the pipeline_runs row with the pre-generated id. We do this
  // ourselves (not via `recordPipelineRun()`) because the helper does not
  // return the inserted row's id, and the orchestrator contract requires
  // surfacing `pipeline_run_id` to the caller. Failure modes below mirror
  // the helper's semantics (Sentry capture + best-effort logging).
  await persistPipelineRun({
    supabase,
    pipelineRunId,
    startedAt,
    status,
    errorMessage,
    itemsProcessed: attemptedCount,
    itemsCreated: created,
    resultPayload,
  });

  return {
    pipeline_run_id: pipelineRunId,
    results_summary: {
      created,
      skipped,
      failed,
    },
  };
}

interface ImportOneFileParams {
  file: MarkdownIngestFile;
  supabase: SupabaseClient<Database>;
  ownerId: string;
  author: string | null;
  callerRole: 'admin' | 'editor';
  override: MarkdownPerFileOverride | undefined;
  t1: T1Helpers;
}

interface ImportOneFileOutcome {
  id: string;
  title: string;
  /** Set when content was flagged as a suspected duplicate via dedup soft-block. */
  suspectedDuplicateOf?: string;
}

async function importOneFile(
  params: ImportOneFileParams,
): Promise<ImportOneFileOutcome> {
  const { file, supabase, ownerId, author, callerRole, override, t1 } = params;

  // Re-parse the file (spec §5.2 re-upload pattern — no temp storage).
  const fmResult = t1.parseMarkdownFrontMatter(file.content);
  const cleanedBody = t1.cleanMdxTags(fmResult.body);
  const titleResult = t1.extractMarkdownTitle({
    frontMatter: fmResult.frontMatter,
    body: cleanedBody,
    filename: file.filename,
  });

  // Dedup gate (re-checked at import for freshness). Soft-block: write
  // proceeds with `dedup_status='suspected_duplicate'` stamp.
  const dedupVerdict = await checkExactDuplicate(supabase, cleanedBody);
  const skipDedup =
    callerRole === 'admin' && override?.skipDedup === true ? true : false;
  const { dedup_status, suspected_duplicate_of } = resolveDedupStamp(
    dedupVerdict.existingId,
    { skipDedup },
  );

  // Resolve draft/final flag. Precedence:
  //   1. Per-file override (`override.draftOrFinal`)
  //   2. Front-matter `status: 'draft' | 'final' | ...`
  //   3. Front-matter `draft: true` → 'draft'
  //   4. Filename heuristic
  const draftOrFinal: 'draft' | 'final' | 'unknown' = (() => {
    if (override?.draftOrFinal) return override.draftOrFinal;
    const fm = fmResult.frontMatter;
    if (fm) {
      if (fm.draft === true || fm.draft === 'true') return 'draft';
      const status = typeof fm.status === 'string' ? fm.status.toLowerCase() : '';
      if (status === 'draft') return 'draft';
      if (status === 'final' || status === 'published' || status === 'live') {
        return 'final';
      }
    }
    return detectDraftFinalFromFilename(file.filename);
  })();

  const publicationStatus = draftFinalToPublicationStatus(draftOrFinal);

  const contentTypeRaw = fmResult.frontMatter?.content_type;
  const contentType =
    typeof contentTypeRaw === 'string' && contentTypeRaw.trim().length > 0
      ? contentTypeRaw
      : 'article';

  const authorFromFrontMatter =
    typeof fmResult.frontMatter?.author === 'string'
      ? (fmResult.frontMatter.author as string)
      : null;

  // Build INSERT payload (spec §7.3 canonical shape).
  // - `content_text_hash` OMITTED per G3 (GENERATED ALWAYS column).
  // - `ingest_source: 'upload'` so trigger writes v1 history with
  //   `change_reason='initial_ingest'` (G17).
  // - `publication_status` set EXPLICITLY (D-A guard) — never relying on
  //   the column DEFAULT.
  // - `governance_review_status` left NULL per spec §9.2.
  // - `next_review_date` / `review_cadence_days` left NULL per spec §3.4.2.
  const insertMetadata: { [k: string]: Json } = {
    original_filename: file.filename,
    file_size: file.sizeBytes ?? Buffer.byteLength(file.content, 'utf8'),
    ingestion_source: 'upload',
  };
  if (suspected_duplicate_of) {
    insertMetadata.suspected_duplicate_of = suspected_duplicate_of;
  }

  const insertPayload = {
    title: titleResult.title,
    content: cleanedBody,
    content_type: contentType,
    platform: 'manual',
    author_name: authorFromFrontMatter ?? author,
    source_file: file.filename,
    ingest_source: 'upload',
    publication_status: publicationStatus,
    metadata: insertMetadata as Json,
    dedup_status,
    created_by: ownerId,
    content_owner_id: ownerId,
  };

  const inserted = await sb<{ id: string; title: string }>(
    supabase
      .from('content_items')
      .insert(insertPayload)
      .select('id, title')
      .single(),
    'upload_markdown_batch.content_items.insert',
  );

  // Classification (G1 + G2). Reads the row back from DB; updates in place.
  await classifyContent({
    supabase,
    itemId: inserted.id,
    force: true,
    userId: SERVICE_ACCOUNT_UUID,
  });

  // Embedding generation. Mirror EP3 build text (title + content).
  try {
    const embeddingText = `${titleResult.title}\n\n${cleanedBody}`;
    const embedding = await generateEmbedding(embeddingText);
    await sb(
      supabase
        .from('content_items')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', inserted.id)
        .select('id'),
      'upload_markdown_batch.content_items.embedding_update',
    );
  } catch (err) {
    // Embedding failure is non-fatal — the item still exists with no
    // semantic-search vector; backfill scripts can repair. Log + continue.
    logBestEffortWarn(
      'upload_markdown_batch.import.embedding_failed',
      `Embedding generation failed for ${file.filename}`,
      {
        filename: file.filename,
        itemId: inserted.id,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // Markdown chunking (spec §7.5) — closes Python markdown-ingest gap.
  // Non-fatal on failure — item is usable without chunks; backfill repairs.
  try {
    await regenerateChunks(supabase, inserted.id, cleanedBody);
  } catch (err) {
    logBestEffortWarn(
      'upload_markdown_batch.import.chunking_failed',
      `Chunk regeneration failed for ${file.filename}`,
      {
        filename: file.filename,
        itemId: inserted.id,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return {
    id: inserted.id,
    title: inserted.title,
    suspectedDuplicateOf: suspected_duplicate_of,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

// `detectDraftFinalFromFilename` is imported from `@/lib/ingest/draft-final-heuristic`.
// `draftFinalToPublicationStatus` is imported from `@/lib/ingest/draft-final-to-publication-status`.

/**
 * Compute the pipeline_runs.status value from the per-file outcome counts.
 *
 *   - 0 attempts (everything excluded) → 'completed'
 *   - 0 failed                          → 'completed'
 *   - some succeeded + some failed      → 'completed_with_errors'
 *   - 0 succeeded + ≥1 failed           → 'failed'
 */
function computeRunStatus(params: {
  failedCount: number;
  createdCount: number;
  attemptedCount: number;
}): 'completed' | 'completed_with_errors' | 'failed' {
  const { failedCount, createdCount, attemptedCount } = params;
  if (attemptedCount === 0) return 'completed';
  if (failedCount === 0) return 'completed';
  if (createdCount === 0) return 'failed';
  return 'completed_with_errors';
}

interface PersistPipelineRunParams {
  supabase: SupabaseClient<Database>;
  pipelineRunId: string;
  startedAt: string;
  status: 'completed' | 'completed_with_errors' | 'failed';
  errorMessage: string | null;
  itemsProcessed: number;
  itemsCreated: string[];
  resultPayload: Json;
}

/**
 * Insert the final pipeline_runs row and emit a Sentry signal for non-healthy
 * runs. Mirrors `recordPipelineRun()` semantics inline so the orchestrator can
 * surface the pre-generated id back to the caller.
 *
 * Never throws — a failed audit-trail insert must not take the orchestrator
 * down with it; the breadcrumb + Sentry capture is the escalation.
 */
async function persistPipelineRun(
  params: PersistPipelineRunParams,
): Promise<void> {
  const {
    supabase,
    pipelineRunId,
    startedAt,
    status,
    errorMessage,
    itemsProcessed,
    itemsCreated,
    resultPayload,
  } = params;

  try {
    await sb(
      supabase
        .from('pipeline_runs')
        .insert({
          id: pipelineRunId,
          pipeline_name: PIPELINE_NAME,
          status,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          items_processed: itemsProcessed,
          items_created: itemsCreated,
          source_filename: null, // batch — no single source filename
          result: resultPayload as Json,
          error_message: errorMessage,
        })
        .select('id'),
      'upload_markdown_batch.pipeline_runs.insert',
    );
  } catch (err) {
    const message =
      err instanceof SupabaseError
        ? `${err.message}${err.code ? ` [${err.code}]` : ''}`
        : err instanceof Error
          ? err.message
          : String(err);

    logBestEffortWarn(
      'upload_markdown_batch.pipeline_runs.insert_failed',
      `Failed to insert pipeline_runs row for ${PIPELINE_NAME}`,
      { pipelineName: PIPELINE_NAME, status, errorMessage, dbError: message },
    );

    Sentry.captureMessage(
      `pipeline_runs insert failed for ${PIPELINE_NAME}: ${message}`,
      {
        level: 'error',
        extra: { pipelineName: PIPELINE_NAME, status, errorMessage },
      },
    );
    return;
  }

  if (status === 'completed') return;

  const level: 'error' | 'warning' = status === 'failed' ? 'error' : 'warning';
  Sentry.captureMessage(
    `Pipeline ${PIPELINE_NAME} ${status}${
      errorMessage ? `: ${errorMessage}` : ''
    }`,
    {
      level,
      tags: { pipeline: PIPELINE_NAME, status },
      extra: {
        pipelineName: PIPELINE_NAME,
        status,
        errorMessage,
        itemsProcessed,
      },
    },
  );
}
