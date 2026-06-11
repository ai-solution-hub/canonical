/**
 * {59.9} — file-first write-back adapter with compensating restore (UC1/UC4
 * file leg).
 *
 * PRODUCT PC-1 (INV-1 dual-write, path-preserved) + PC-2 (INV-2 atomic save).
 * S330 RATIFICATION 1: file-first + compensating-restore is V1 — NOT deferred
 * behind Spike#3.
 *
 * ── The atomicity model (INV-2) ──────────────────────────────────────────────
 * A file-backed content_item's canonical bytes live on the cocoindex
 * source-binding folder (`COCOINDEX_SOURCE_PATH`, bound at `flow.py:2896`).
 * The file's source-relative POSIX path IS `source_documents.storage_path`
 * (`flow.py:1981` `"storage_path": rel_path`, where
 * `rel_path = path.relative_to(source_path).as_posix()` — `flow.py:1574`), and
 * that rel_path is ALSO the uuid5 seed for the per-document PKs
 * (`content_item_id = uuid5(_KH_PIPELINE_DOC_NS, "ci:" + rel_path)` —
 * `flow.py:1952`). Writing the edited bytes to a DIFFERENT path would mint a
 * NEW identity on the next walk and orphan the old content — INV-1's "MUST NOT
 * write to a different path" hazard. So the file leg writes to the EXACT
 * existing `storage_path`, never a derived or normalised path.
 *
 * Ordering (file-first):
 *   1. snapshot prior file bytes;
 *   2. write the file leg to the exact path; on file-write failure -> abort
 *      BEFORE the DB write, so there is exactly ONE failure state (the DB is
 *      never touched and the file is never partially ahead of the DB);
 *   3. DB leg (the {59.8} content_items + content_history write, injected as
 *      `applyDbLeg`); on DB-write failure AFTER a successful file write ->
 *      RESTORE the prior bytes (read-then-restore compensating write) so
 *      neither leg is left applied.
 *
 * This is NOT a true two-phase commit. There is a residual crash-window:
 * if the process dies between a successful file write and the DB write (or
 * before the compensating restore completes), the file is ahead of the DB.
 * That divergence is self-healing — the next cocoindex POST/walk recomputes
 * `content_text_hash` from the on-disk bytes and reconciles the DB row, so the
 * window closes on the following ingest rather than leaving a permanent split.
 * (Risks — documented, accepted for V1.)
 *
 * The user always sees ONE save outcome: either the save succeeded, or it
 * failed and nothing was left applied. A compensating restore that itself
 * degrades (e.g. the source folder vanished mid-save) is surfaced as a
 * non-fatal warning via the returned `warnings` list — it never masks the
 * original DB failure, which is always re-raised.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@/lib/logger';
import { tryQuery, isOk, type PostgrestLike } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/**
 * The DB leg of the save — the caller's {59.8} content_items +
 * content_history write. Injected (rather than performed here) so the
 * adapter owns ONLY the file-first ordering and the compensating restore;
 * the canonical DB mutation stays in the items route where it already lives.
 * It is invoked exactly once, AFTER a successful file write.
 */
export type ApplyDbLeg = () => Promise<void>;

export interface WriteBackParams {
  supabase: SupabaseClient<Database>;
  /** content_item PK — used only to resolve the linked source_document. */
  contentItemId: string;
  /** The new canonical bytes to write to the file (and that the DB leg stores). */
  newContent: string;
  /** The {59.8} content_items + content_history write. Runs after the file leg. */
  applyDbLeg: ApplyDbLeg;
  /** Optional structured-log context tag for the storage_path read. */
  context?: string;
}

export interface WriteBackResult {
  /** True once both legs that apply DID apply (file leg only when fileBacked). */
  applied: true;
  /** True when the item is backed by a source_document with a storage_path. */
  fileBacked: boolean;
  /**
   * Non-fatal warnings — currently only a degraded compensating restore.
   * Empty on the happy path. Surface these via `warningsEnvelope()` at the
   * route boundary so the user still sees ONE save outcome.
   */
  warnings: readonly string[];
}

/**
 * The flat storage_path resolution shape the resolver consumes. Populated by
 * TWO plain per-table reads (content_items.source_document_id, then
 * source_documents.storage_path by PK) — NOT a PostgREST FK embed: the
 * content_items -> source_documents FK was deliberately DROPPED in migration
 * 20260602073942 (ID-64.3 BUG-E — the cocoindex autocommit write model cannot
 * satisfy cross-target FKs), so an embedded `source_documents(...)` select
 * fails with PGRST200 against the live schema (bl-286 C1 regression).
 */
interface StoragePathRow {
  source_document_id: string | null;
  storage_path: string | null;
}

/**
 * Resolve the absolute on-disk path for a file-backed content_item.
 *
 * abs = COCOINDEX_SOURCE_PATH (flow source-binding folder) joined with the
 * source-relative POSIX `storage_path`. `storage_path` is consumed verbatim —
 * NOT re-normalised — because it is the uuid5 PK seed and any rewrite would
 * mint a different identity (INV-1).
 *
 * Returns `null` when the item is not file-backed (no source_document_id or
 * no storage_path), or when the source-binding folder is unset (the flow is
 * in idle mode — `flow.py:2896` — so there is no file leg to write).
 */
function resolveAbsolutePath(row: StoragePathRow): string | null {
  if (!row.source_document_id || !row.storage_path) return null;
  const sourceRoot = process.env.COCOINDEX_SOURCE_PATH;
  if (!sourceRoot) return null;
  return join(sourceRoot, row.storage_path);
}

/**
 * File-first write-back with compensating restore.
 *
 * See the module header for the full atomicity model. Throws if the
 * storage_path read fails, if the file write fails (DB untouched), or if the
 * DB leg fails (file restored). On a thrown DB-leg failure the prior bytes are
 * restored before the error propagates; a degraded restore is logged as a
 * warning on the re-raised error's `writeBackWarnings` property AND would be
 * present on a successful result — but a DB failure always rejects.
 */
export async function writeBackFileFirst(
  params: WriteBackParams,
): Promise<WriteBackResult> {
  const { supabase, contentItemId, newContent, applyDbLeg, context } = params;

  // ── Resolve the file leg target ────────────────────────────────────────────
  // Step 1: read source_document_id off content_items via tryQuery
  // (lib/supabase/safe.ts) — never a raw client. A failed read aborts the
  // whole save BEFORE either leg touches anything.
  //
  // bl-286 C1: this MUST be a plain column read, NOT an embedded
  // `source_documents(storage_path)` select — the content_items ->
  // source_documents FK was dropped in migration 20260602073942 (BUG-E), so
  // PostgREST has no relationship to embed through and the embed fails with
  // PGRST200, which 500'd every content-bytes PATCH.
  const itemResolution = await tryQuery<{
    source_document_id: string | null;
  }>(
    supabase
      .from('content_items')
      .select('source_document_id')
      .eq('id', contentItemId)
      .maybeSingle() as unknown as PostgrestLike<{
      source_document_id: string | null;
    }>,
    context ?? 'edit-intent.write-back.resolve-storage-path',
  );
  if (!isOk(itemResolution)) {
    throw itemResolution.error;
  }

  const sourceDocumentId = itemResolution.data?.source_document_id ?? null;

  // ── {59.10} / PC-3 (INV-3) — source-less content_item GUARD (bl-266) ─────────
  // S330 RATIFICATION 2 + Liam steer: a content_item with NO linked
  // source_document is an ANOMALY TO GUARD, not a first-class write path. We do
  // NOT write a file, do NOT auto-create a source_document, and do NOT mint a
  // connector='mcp' storage path (the "opt-in materialise-to-file" affordance is
  // explicitly NOT built — v1.1 at most, and only if bl-266 enforcement doesn't
  // first eliminate the population). The KH-DB-only leg (the {59.8} content_items
  // + content_history write WITH edit_intent) STILL runs so the user's save
  // applies, but we emit a structured anomaly log so the source-less population
  // is observable + traceable to bl-266 (a CONSUMED cross_doc_link —
  // docs/reference/backlog/266.md; bl-266 enforces later, this slice only
  // surfaces the anomaly NOW). OQ-59-3 prod sweep sizes the population so the
  // anomaly-log volume is understood (TECH Open-item-2).
  if (!sourceDocumentId) {
    logger.warn(
      {
        event: 'source_less_content_item_edit_back',
        contentItemId,
        caller: context ?? 'edit-intent.write-back.resolve-storage-path',
      },
      'Edit-back on a source-less content_item — no source_document linked; ' +
        'wrote KH-DB-only (no file, no auto-created source_document, no mcp ' +
        'storage-path mint). Tracked to bl-266.',
    );
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  // Step 2: resolve storage_path directly off source_documents by PK — the
  // FK-less counterpart of the former embed (see Step 1 note).
  const docResolution = await tryQuery<{ storage_path: string | null }>(
    supabase
      .from('source_documents')
      .select('storage_path')
      .eq('id', sourceDocumentId)
      .maybeSingle() as unknown as PostgrestLike<{
      storage_path: string | null;
    }>,
    context ?? 'edit-intent.write-back.resolve-storage-path',
  );
  if (!isOk(docResolution)) {
    throw docResolution.error;
  }

  // With the FK dropped, ON DELETE SET NULL no longer auto-fires — a deleted
  // source_documents row can leave content_items.source_document_id dangling.
  // Surface the dangling reference (observable, distinct from the source-less
  // anomaly) and fall through to the DB-only path so the save still lands.
  if (docResolution.data === null) {
    logger.warn(
      {
        event: 'dangling_source_document_reference',
        contentItemId,
        sourceDocumentId,
        caller: context ?? 'edit-intent.write-back.resolve-storage-path',
      },
      'Edit-back found content_items.source_document_id pointing at a ' +
        'missing source_documents row (dangling post-FK-drop, migration ' +
        '20260602073942); wrote KH-DB-only — no file leg.',
    );
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  const absPath = resolveAbsolutePath({
    source_document_id: sourceDocumentId,
    storage_path: docResolution.data.storage_path ?? null,
  });

  // ── Source-backed but no file leg to write: idle-mode flow ──────────────────
  // The item HAS a linked source_document but the source-binding folder is unset
  // (`COCOINDEX_SOURCE_PATH` absent — flow.py idle mode) or the storage_path is
  // absent, so there is no on-disk file to rewrite. This is NOT the source-less
  // anomaly above; the DB-only path applies the canonical {59.8} write as the
  // single source of the save outcome.
  if (!absPath) {
    await applyDbLeg();
    return { applied: true, fileBacked: false, warnings: [] };
  }

  // ── (1) Snapshot prior bytes ────────────────────────────────────────────────
  const priorBytes = await readFile(absPath, 'utf8');

  // ── (2) Write the file leg to the EXACT existing path ───────────────────────
  // On failure this throws BEFORE the DB leg — one failure state, DB untouched.
  await writeFile(absPath, newContent, 'utf8');

  // ── (3) DB leg; compensating restore on failure ────────────────────────────
  const warnings: string[] = [];
  try {
    await applyDbLeg();
  } catch (dbErr) {
    // RESTORE: read-then-restore the snapshot so neither leg is left applied.
    // The restore is best-effort — if IT degrades (folder vanished, disk
    // full), collect a warning but ALWAYS re-raise the original DB error so
    // the user sees ONE save outcome (the failure), never a swallowed error.
    try {
      await writeFile(absPath, priorBytes, 'utf8');
    } catch (restoreErr) {
      warnings.push(
        'Save failed and the file could not be restored to its prior state — ' +
          'the next ingest will reconcile it from disk.',
      );
      const augmented =
        dbErr instanceof Error
          ? dbErr
          : new Error(typeof dbErr === 'string' ? dbErr : 'Save failed');
      (augmented as Error & { writeBackWarnings?: readonly string[] }).cause =
        restoreErr;
      (
        augmented as Error & { writeBackWarnings?: readonly string[] }
      ).writeBackWarnings = warnings;
      throw augmented;
    }
    throw dbErr;
  }

  return { applied: true, fileBacked: true, warnings };
}
