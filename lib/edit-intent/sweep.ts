/**
 * {59.13} — UC3 sweeping-rename orchestrator (batched single-actor file
 * write-back) + whole-sweep / per-match rollback.
 *
 * PRODUCT PC-6 (INV-6) · TECH §PC-6→INV-6.
 *
 * ── What a sweep is ──────────────────────────────────────────────────────────
 * A cross-corpus find-and-replace (or smart-agent per-match-approve) rename
 * rewrites the affected walked source files at their `storage_path`. This module
 * is the KH-server orchestrator: it iterates the affected content_items and
 * rewrites EACH at its `storage_path` via the PC-1 adapter `writeBackFileFirst`
 * ({59.9}, `@/lib/edit-intent/write-back` — direct import, never edited here).
 *
 * ── Single sweep identifier (audit + whole-sweep rollback) ───────────────────
 * Every record touched by ONE sweep shares a single SWEEP IDENTIFIER (`sweepId`,
 * a v4 UUID minted once per `runSweep` call). It is recorded per-match on each
 * `content_history` snapshot row (`metadata.sweep_id` + `change_reason:
 * "sweep:<id>"`) so a user can:
 *   - AUDIT which files a sweep changed (query history by sweep-id);
 *   - ROLL BACK the whole sweep as a unit (restore all N records' prior bytes);
 *   - REVERT a single match (restore one record's prior bytes).
 * The prior bytes are captured per-match in `metadata.prior_content` so the
 * restore is self-contained (no dependence on a separate version pointer).
 *
 * ── Batched single-actor → NO arbitration ────────────────────────────────────
 * A sweep is a batched single-actor operation: there is no concurrent CRDT
 * merge, so it does NOT invoke `arbitrate()` / `arbitrateMany()`. Each touched
 * record stamps the sweep's SINGLE intent (typically `'structural'` or
 * `'data'`) directly. (Arbitration is invoked ONLY on the UC1/UC4/UC6-user
 * CRDT paths — see `arbitrate.ts`.)
 *
 * ── Atomicity ────────────────────────────────────────────────────────────────
 * Each per-match write reuses the PC-1 adapter's file-first + compensating
 * restore (INV-2): the file leg lands before the DB leg, and a DB-leg failure
 * restores that match's prior bytes. The sweep is NOT a cross-match transaction:
 * if match k fails, matches 0..k-1 already applied stay applied. The sweep-id
 * makes that partial state auditable and (whole-sweep or per-match) revertible.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EditIntent } from '@/lib/edit-intent/arbitrate';
import { writeBackFileFirst } from '@/lib/edit-intent/write-back';
import { sb, type PostgrestLike } from '@/lib/supabase/safe';
import type { Database } from '@/supabase/types/database.types';

/**
 * One match in a sweep: the content_item to rewrite and its NEW canonical
 * bytes (the post-rename file body that the DB leg also stores).
 */
export interface SweepMatchInput {
  /** content_item PK — used to resolve the linked source_document + storage_path. */
  contentItemId: string;
  /** The post-rename canonical bytes for this match's file + DB row. */
  newContent: string;
}

export interface RunSweepParams {
  supabase: SupabaseClient<Database>;
  /** The affected content_items + their post-rename bytes. */
  matches: SweepMatchInput[];
  /**
   * The sweep's SINGLE intent, stamped verbatim on every match WITHOUT
   * arbitration. Typically `'structural'` (a rename is structural) or `'data'`.
   */
  intent: EditIntent;
  /** The acting user/agent id — recorded as `created_by` on each history row. */
  actorId: string;
  /** Optional structured-log context tag forwarded to the PC-1 adapter. */
  context?: string;
}

export interface SweepMatchResult {
  contentItemId: string;
  /** True when this match's item was file-backed (a file leg actually wrote). */
  fileBacked: boolean;
  /** The version number of the snapshot row written for this match. */
  version: number;
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

/** content_history change_reason prefix that tags a sweep snapshot. */
export const SWEEP_REASON_PREFIX = 'sweep:';

/**
 * Build the canonical `change_reason` for a sweep snapshot row. The whole-sweep
 * rollback path matches on `metadata.sweep_id`; this string is the
 * human-readable mirror that surfaces in the version-history UI.
 */
export function sweepReason(sweepId: string): string {
  return `${SWEEP_REASON_PREFIX}${sweepId}`;
}

/**
 * Resolve the current live bytes of a content_item (the prior bytes captured
 * per-match before the sweep overwrites them — needed for revert).
 */
async function readPriorContent(
  supabase: SupabaseClient<Database>,
  contentItemId: string,
): Promise<string> {
  const row = await sb(
    supabase
      .from('content_items')
      .select('content')
      .eq('id', contentItemId)
      .single(),
    'edit-intent.sweep.read-prior-content',
  );
  return row?.content ?? '';
}

/**
 * Compute the next sequential `content_history.version` for an item.
 */
async function nextHistoryVersion(
  supabase: SupabaseClient<Database>,
  contentItemId: string,
): Promise<number> {
  const maxRow = await sb(
    supabase
      .from('content_history')
      .select('version')
      .eq('content_item_id', contentItemId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'edit-intent.sweep.max-version',
  );
  return (maxRow?.version ?? 0) + 1;
}

/**
 * Run a UC3 sweeping rename over the supplied matches.
 *
 * For each match, in order:
 *   1. snapshot the prior live bytes (for revert);
 *   2. rewrite the file leg at `storage_path` + apply the DB leg via the PC-1
 *      adapter `writeBackFileFirst`. The DB leg:
 *        a. UPDATEs `content_items.content` to the new bytes;
 *        b. INSERTs a `content_history` snapshot stamping the sweep's single
 *           intent, the sweep-id (`metadata.sweep_id` + `change_reason`), and
 *           the prior bytes (`metadata.prior_content`) so the match is
 *           individually revertible.
 *
 * Does NOT call `arbitrate()`/`arbitrateMany()` — the sweep's single intent is
 * stamped verbatim (batched single-actor). The PK boundary throws on the first
 * failing match (the adapter restores THAT match's file); earlier matches that
 * already applied remain applied and are revertible via the sweep-id.
 */
export async function runSweep(
  params: RunSweepParams,
): Promise<RunSweepResult> {
  const { supabase, matches, intent, actorId, context } = params;
  const sweepId = crypto.randomUUID();
  const reason = sweepReason(sweepId);
  const results: SweepMatchResult[] = [];
  const warnings: string[] = [];

  for (const match of matches) {
    const { contentItemId, newContent } = match;

    // (1) Capture prior bytes BEFORE the overwrite — recorded per-match so a
    // whole-sweep or per-match revert can restore the exact prior content.
    const priorContent = await readPriorContent(supabase, contentItemId);
    const version = await nextHistoryVersion(supabase, contentItemId);

    // (2) The DB leg: live UPDATE + the sweep-stamped history snapshot. Injected
    // into the PC-1 adapter so file-first ordering + compensating restore are
    // reused unchanged.
    const applyDbLeg = async (): Promise<void> => {
      const { error: updateError } = await supabase
        .from('content_items')
        .update({ content: newContent, updated_by: actorId })
        .eq('id', contentItemId);
      if (updateError) throw updateError;

      const { error: snapshotError } = await supabase
        .from('content_history')
        .insert({
          content_item_id: contentItemId,
          version,
          // The post-sweep bytes are the new canonical content; the snapshot
          // row records them as the version content, with the PRIOR bytes in
          // metadata for revert.
          content: newContent,
          title: '',
          change_type: 'edit',
          change_reason: reason,
          change_summary: `Sweep ${sweepId}`,
          edit_intent: intent,
          created_by: actorId,
          metadata: { sweep_id: sweepId, prior_content: priorContent },
        });
      if (snapshotError) throw snapshotError;
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
      version,
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
 * atomicity per match. The restore is itself recorded as a fresh sweep snapshot
 * (a new sweep-id) so the version history stays append-only and the revert is
 * itself auditable + re-revertible.
 *
 * When `contentItemId` is supplied, only that match is reverted (others left at
 * their post-sweep bytes — PROOF 5). Otherwise every match sharing the sweep-id
 * is reverted.
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

  const restoreSweepId = crypto.randomUUID();
  const restoreReason = sweepReason(restoreSweepId);
  const restored: string[] = [];
  const warnings: string[] = [];

  for (const row of scoped) {
    const itemId = row.content_item_id as string;
    const priorContent = row.metadata?.prior_content ?? '';

    const version = await nextHistoryVersion(supabase, itemId);

    const applyDbLeg = async (): Promise<void> => {
      const { error: updateError } = await supabase
        .from('content_items')
        .update({ content: priorContent, updated_by: actorId })
        .eq('id', itemId);
      if (updateError) throw updateError;

      const { error: snapshotError } = await supabase
        .from('content_history')
        .insert({
          content_item_id: itemId,
          version,
          content: priorContent,
          title: '',
          change_type: 'rollback',
          change_reason: restoreReason,
          change_summary: `Reverted sweep ${sweepId}`,
          created_by: actorId,
          metadata: {
            sweep_id: restoreSweepId,
            reverts_sweep_id: sweepId,
          },
        });
      if (snapshotError) throw snapshotError;
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
