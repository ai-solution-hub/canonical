/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back).
 *
 * PRODUCT PC-6 (INV-6) · TECH §PC-6→INV-6.
 *
 * ── What a sweep is ──────────────────────────────────────────────────────────
 * A cross-corpus find-and-replace (or smart-agent per-match-approve) rename
 * rewrites the affected walked source files at their `storage_path`. This module
 * is the KH-server orchestrator: it iterates the affected records (ID-131
 * {131.17}: source_documents, re-pointed off content_items) and rewrites EACH
 * at its `storage_path` via the PC-1 adapter `writeBackFileFirst`
 * ({59.9}, `@/lib/edit-intent/write-back` — direct import, never edited here).
 *
 * ── Single sweep identifier (audit) ──────────────────────────────────────────
 * Every record touched by ONE sweep shares a single SWEEP IDENTIFIER (`sweepId`,
 * a v4 UUID minted once per `runSweep` call) and is returned per-match so a
 * caller can correlate which records one sweep touched.
 *
 * ID-131 FIX-SLICE (S447, BI-34): the per-match `content_history` audit
 * snapshot (`metadata.sweep_id` + `change_reason: "sweep:<id>"` +
 * `metadata.prior_content`) that USED to back audit/rollback was retired —
 * `content_history.content_item_id` had been a dead FK since the M0c
 * debris-wipe (content_items is permanently empty). `runSweep` stopped
 * writing it (every insert was an FK violation).
 *
 * ID-131.19 S450 Wave 1 Fix 4 (this Subtask): `rollbackSweep` — whose restore
 * mechanism still READ `content_history` by `metadata.sweep_id` post-S447 —
 * is REMOVED entirely. content_history drops at M6 and `rollbackSweep` had 0
 * production callers (its only caller, `app/api/items/[id]/rollback/route.ts`,
 * was already deleted under the parallel G-IMS-DELETE lane; confirmed via
 * `gitnexus_impact` — 0 upstream — and a repo-wide grep). Keeping a function
 * whose only behaviour is a read against a table about to be dropped, with no
 * caller to ever notice it start erroring, is exactly the "silent stub" this
 * Subtask's brief prohibits — removed honestly instead. Whole-sweep audit /
 * revert is therefore no longer offered by this module; a replacement would
 * need a new persisted trail on the new record model, out of this Subtask's
 * scope.
 *
 * ── Batched single-actor → NO arbitration ────────────────────────────────────
 * A sweep is a batched single-actor operation: there is no concurrent CRDT
 * merge, so it does NOT invoke `arbitrate()` / `arbitrateMany()`. (Arbitration
 * is invoked ONLY on the UC1/UC4/UC6-user CRDT paths — see `arbitrate.ts`.)
 * The sweep's SINGLE intent (`RunSweepParams.intent`, typically `'structural'`
 * or `'data'`) is part of the caller contract but, post the S447 FIX-SLICE, is
 * no longer stamped anywhere observable (it was only ever recorded on the
 * now-retired content_history row).
 *
 * ── Atomicity ────────────────────────────────────────────────────────────────
 * Each per-match write reuses the PC-1 adapter's file-first + compensating
 * restore (INV-2): the file leg lands before the DB leg, and a DB-leg failure
 * restores that match's prior bytes. The sweep is NOT a cross-match transaction:
 * if match k fails, matches 0..k-1 already applied stay applied.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EditIntent } from '@/lib/edit-intent/arbitrate';
import { writeBackFileFirst } from '@/lib/edit-intent/write-back';
import type { Database } from '@/supabase/types/database.types';

/**
 * One match in a sweep: the record to rewrite and its NEW canonical bytes
 * (the post-rename file body that the DB leg also stores).
 */
export interface SweepMatchInput {
  /**
   * source_documents PK — used to resolve storage_path (ID-131 {131.17}
   * re-point; field name kept as `contentItemId` for caller-contract
   * stability — mirrors `write-back.ts`'s `WriteBackParams.contentItemId`).
   */
  contentItemId: string;
  /** The post-rename canonical bytes for this match's file + DB row. */
  newContent: string;
}

export interface RunSweepParams {
  supabase: SupabaseClient<Database>;
  /** The affected source_documents + their post-rename bytes. */
  matches: SweepMatchInput[];
  /**
   * The sweep's SINGLE intent. Kept for caller-contract stability
   * (batched-single-actor, no arbitration) but no longer stamped anywhere
   * observable — it was only ever recorded on the now-retired content_history
   * row (ID-131 FIX-SLICE, S447, BI-34).
   */
  intent: EditIntent;
  /** The acting user/agent id — recorded as `updated_by` on the live update. */
  actorId: string;
  /** Optional structured-log context tag forwarded to the PC-1 adapter. */
  context?: string;
}

export interface SweepMatchResult {
  contentItemId: string;
  /** True when this match's item was file-backed (a file leg actually wrote). */
  fileBacked: boolean;
  // `version` (content_history snapshot version) retired here — the
  // content_history audit write is gone (dead FK post-M0c debris-wipe; table
  // drops at M6, BI-34). ID-131 FIX-SLICE (S447).
}

export interface RunSweepResult {
  /** The single sweep identifier shared by every match (v4 UUID). */
  sweepId: string;
  /** Count of matches that applied. */
  matchCount: number;
  matches: SweepMatchResult[];
  /** Non-fatal warnings bubbled up from per-match compensating restores. */
  warnings: readonly string[];
}

/**
 * Run a UC3 sweeping rename over the supplied matches.
 *
 * For each match, in order:
 *   1. rewrite the file leg at `storage_path` + apply the DB leg via the PC-1
 *      adapter `writeBackFileFirst`. The DB leg UPDATEs
 *      `source_documents.extracted_text` to the new bytes (ID-131 {131.17}
 *      re-point off `content_items.content`).
 *
 * ID-131 FIX-SLICE (S447, BI-34): the DB leg used to ALSO INSERT a
 * `content_history` snapshot (sweep-id + prior bytes) so the match was
 * individually revertible. That insert is retired — `content_item_id` has
 * been a dead FK since the M0c debris-wipe (content_items is permanently
 * empty; every insert FK-violated) and content_history itself drops at M6.
 * `runSweep` had 0 production callers, so this was a same-day-safe removal.
 * ID-131.19 S450 Wave 1 Fix 4 (this Subtask): the restore/rollback half of
 * this story (`rollbackSweep`) is now REMOVED entirely — see the module
 * header for why.
 *
 * Does NOT call `arbitrate()`/`arbitrateMany()` — the sweep's single intent is
 * batched single-actor (see `RunSweepParams.intent`). The PK boundary throws
 * on the first failing match (the adapter restores THAT match's file);
 * earlier matches that already applied remain applied.
 */
export async function runSweep(
  params: RunSweepParams,
): Promise<RunSweepResult> {
  const { supabase, matches, intent, actorId, context } = params;
  void intent; // caller-contract only post-retirement — see RunSweepParams.intent
  const sweepId = crypto.randomUUID();
  const results: SweepMatchResult[] = [];
  const warnings: string[] = [];

  for (const match of matches) {
    const { contentItemId, newContent } = match;

    // The DB leg: live UPDATE only. Injected into the PC-1 adapter so
    // file-first ordering + compensating restore are reused unchanged.
    // ID-131 {131.17}: re-pointed off content_items onto source_documents
    // (`content` -> `extracted_text`).
    const applyDbLeg = async (): Promise<void> => {
      const { error: updateError } = await supabase
        .from('source_documents')
        .update({ extracted_text: newContent, updated_by: actorId })
        .eq('id', contentItemId);
      if (updateError) throw updateError;
    };

    const writeBack = await writeBackFileFirst({
      supabase,
      contentItemId,
      newContent,
      applyDbLeg,
      context: context ?? 'edit-intent.sweep.write-back',
    });
    for (const w of writeBack.warnings) warnings.push(w);

    results.push({
      contentItemId,
      fileBacked: writeBack.fileBacked,
    });
  }

  return {
    sweepId,
    matchCount: results.length,
    matches: results,
    warnings,
  };
}

// rollbackSweep / RollbackSweepParams / RollbackSweepResult / SweepHistoryRow
// REMOVED (ID-131.19 S450 Wave 1 Fix 4) — see the module header for the full
// rationale (0 production callers, content_history read about to break at
// M6, no silent-stub value in keeping it).
