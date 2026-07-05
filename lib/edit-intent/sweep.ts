/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back) + whole-sweep / per-match rollback.
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
 * ── Single sweep identifier (audit + whole-sweep rollback) ───────────────────
 * Every record touched by ONE sweep shares a single SWEEP IDENTIFIER (`sweepId`,
 * a v4 UUID minted once per `runSweep` call) and is returned per-match so a
 * caller can correlate which records one sweep touched.
 *
 * ID-131 FIX-SLICE (S447, BI-34): the per-match `content_history` audit
 * snapshot (`metadata.sweep_id` + `change_reason: "sweep:<id>"` +
 * `metadata.prior_content`) that USED to back audit/rollback is retired —
 * `content_history.content_item_id` has been a dead FK since the M0c
 * debris-wipe (content_items is permanently empty) and content_history
 * itself drops at M6. `runSweep` no longer writes it (every insert was an FK
 * violation). `rollbackSweep`'s restore mechanism still READS
 * `content_history` by `metadata.sweep_id` (kept — 0 production callers, see
 * below) but will find nothing for any sweep run after this fix; it remains
 * testable only against pre-seeded rows (see `sweep.test.ts`).
 *
 * ── Batched single-actor → NO arbitration ────────────────────────────────────
 * A sweep is a batched single-actor operation: there is no concurrent CRDT
 * merge, so it does NOT invoke `arbitrate()` / `arbitrateMany()`. (Arbitration
 * is invoked ONLY on the UC1/UC4/UC6-user CRDT paths — see `arbitrate.ts`.)
 * The sweep's SINGLE intent (`RunSweepParams.intent`, typically `'structural'`
 * or `'data'`) is part of the caller contract but, post this FIX-SLICE, is no
 * longer stamped anywhere observable (it was only ever recorded on the now-
 * retired content_history row).
 *
 * ── Atomicity ────────────────────────────────────────────────────────────────
 * Each per-match write reuses the PC-1 adapter's file-first + compensating
 * restore (INV-2): the file leg lands before the DB leg, and a DB-leg failure
 * restores that match's prior bytes. The sweep is NOT a cross-match transaction:
 * if match k fails, matches 0..k-1 already applied stay applied. Per-sweep
 * audit/revert (via the sweep-id) is no longer backed by a persisted trail —
 * see the FIX-SLICE note above.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EditIntent } from '@/lib/edit-intent/arbitrate';
import { writeBackFileFirst } from '@/lib/edit-intent/write-back';
import { sb, type PostgrestLike } from '@/lib/supabase/safe';
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
 * `runSweep` had 0 production callers, so this is a same-day-safe removal;
 * see `rollbackSweep` below for the now-consequence (it can no longer find
 * anything to restore for a sweep run after this fix).
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

export interface RollbackSweepParams {
  supabase: SupabaseClient<Database>;
  /** The sweep identifier whose matches to revert. */
  sweepId: string;
  /** The acting user/agent id — recorded on the compensating snapshot rows. */
  actorId: string;
  /**
   * When set, revert ONLY this match (per-match revert). When omitted, revert
   * the WHOLE sweep (all N matches) as a unit.
   */
  contentItemId?: string;
  /** Optional structured-log context tag forwarded to the PC-1 adapter. */
  context?: string;
}

export interface RollbackSweepResult {
  sweepId: string;
  /** Count of matches restored. */
  restoredCount: number;
  restored: string[];
  warnings: readonly string[];
}

/**
 * A sweep snapshot row, as fetched for rollback. The `metadata.prior_content`
 * carries the exact bytes to restore for this match.
 */
interface SweepHistoryRow {
  content_item_id: string | null;
  metadata: { sweep_id?: string; prior_content?: string } | null;
}

/**
 * Roll back a sweep — whole-sweep (all N matches) or a single match.
 *
 * Restoration reuses the PC-1 adapter so the file leg is restored FIRST (to the
 * captured prior bytes) and the DB leg follows, keeping the same one-outcome
 * atomicity per match.
 *
 * When `contentItemId` is supplied, only that match is reverted (others left at
 * their post-sweep bytes — PROOF 5). Otherwise every match sharing the sweep-id
 * is reverted.
 *
 * ID-131 FIX-SLICE (S447, BI-34): the compensating restore used to ALSO
 * INSERT a fresh content_history snapshot row recording the revert. That
 * insert is retired (same dead-FK reason as `runSweep`). The READ below
 * (fetching sweep-member rows by `metadata->>sweep_id`) is UNCHANGED —
 * `rollbackSweep` has 0 production callers (its only caller,
 * `app/api/items/[id]/rollback/route.ts`, has already been deleted under the
 * parallel G-IMS-DELETE lane), so this function is only reachable from
 * `sweep.test.ts`, which now seeds `content_history` rows directly since
 * `runSweep` no longer writes them.
 */
export async function rollbackSweep(
  params: RollbackSweepParams,
): Promise<RollbackSweepResult> {
  const { supabase, sweepId, actorId, contentItemId, context } = params;

  // Fetch every snapshot row for this sweep-id (audit-by-sweep). The
  // metadata->>'sweep_id' filter is the canonical whole-sweep selector.
  const rows = await sb<SweepHistoryRow[]>(
    supabase
      .from('content_history')
      .select('content_item_id, metadata')
      // metadata->>sweep_id is the canonical whole-sweep selector. The select
      // shape (content_item_id + the JSONB metadata) is hand-typed as
      // SweepHistoryRow[] because the generated row type widens metadata to a
      // bare Json; the coercion through PostgrestLike (the shared alias from
      // @/lib/supabase/safe) narrows it to the {sweep_id, prior_content} shape
      // the sweep writer guarantees, rather than `as never` which would swallow
      // any unrelated type error on the chain.
      .eq('metadata->>sweep_id', sweepId) as unknown as PostgrestLike<
      SweepHistoryRow[]
    >,
    'edit-intent.sweep.rollback.fetch',
  );

  // Scope to a single match when contentItemId is supplied (per-match revert).
  const scoped = (rows ?? []).filter(
    (r) =>
      r.content_item_id &&
      r.metadata?.sweep_id === sweepId &&
      (contentItemId ? r.content_item_id === contentItemId : true),
  );

  const restored: string[] = [];
  const warnings: string[] = [];

  for (const row of scoped) {
    const itemId = row.content_item_id as string;
    const priorContent = row.metadata?.prior_content ?? '';

    // ID-131 {131.17}: re-pointed off content_items onto source_documents
    // (`content` -> `extracted_text`).
    const applyDbLeg = async (): Promise<void> => {
      const { error: updateError } = await supabase
        .from('source_documents')
        .update({ extracted_text: priorContent, updated_by: actorId })
        .eq('id', itemId);
      if (updateError) throw updateError;
    };

    const writeBack = await writeBackFileFirst({
      supabase,
      contentItemId: itemId,
      newContent: priorContent,
      applyDbLeg,
      context: context ?? 'edit-intent.sweep.rollback.write-back',
    });
    for (const w of writeBack.warnings) warnings.push(w);
    restored.push(itemId);
  }

  return {
    sweepId,
    restoredCount: restored.length,
    restored,
    warnings,
  };
}
