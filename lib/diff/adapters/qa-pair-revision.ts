/**
 * qa-pair-revision adapter (ID-117 {117.5}, cluster A).
 *
 * Pure mapper: a QAPairHistoryEntry row → UnifiedRevision.
 *
 * This adapter is a PURE FUNCTION. It performs no fetch, no DB access, and
 * no diff-storage write. It lifts and generalises the existing `toRevisionBlob`
 * logic at components/qa/qa-revision-history.tsx:45 into the new abstraction —
 * that component is NOT edited here (wave-2/4 re-points callers — Subtask 117.7).
 *
 * Field mapping (parity with toRevisionBlob):
 * - text         ← answer_standard   (the diffable body for the Q&A leg, v1 minimal view)
 * - changeType   ← origin_kind       (no change_type column on q_a_pair_history)
 * - changeSummary → always null       (no change_summary column on q_a_pair_history)
 * - createdAt    ← changed_at        (the revision timestamp column)
 * - editIntent   ← edit_intent       (null for pre-feature rows)
 *
 * Caller convention: both blobs in a UnifiedDiff MUST share the same qaPairId
 * (adapters enforce same-record by construction — INV-1). This adapter does NOT
 * validate that constraint; the caller must pass the correct qaPairId for both
 * older and newer rows.
 */

import type { UnifiedRevision } from '@/lib/diff/unified-revision';
import type { QAPairHistoryEntry } from '@/lib/query/fetchers';

/**
 * Map a q_a_pair_history row (QAPairHistoryEntry shape) to a UnifiedRevision.
 *
 * @param row           - A single history entry from GET /api/q-a-pairs/[id]/history.
 * @param qaPairId      - The q_a_pairs.id this history row belongs to. Both blobs in a
 *                        UnifiedDiff must share this value.
 * @param createdByLabel - Resolved display name for the author (caller resolves via
 *                         useDisplayNames or equivalent; this adapter is display-name-agnostic).
 */
export function qaPairRevisionToUnified(
  row: QAPairHistoryEntry,
  qaPairId: string,
  createdByLabel: string,
): UnifiedRevision {
  return {
    recordKind: 'qa_pair',
    recordId: qaPairId,
    version: row.version,
    // Text projection: answer_standard is the diffable surface for Q&A revisions
    // (the v1 minimal view — matches toRevisionBlob in qa-revision-history.tsx:51).
    text: row.answer_standard,
    // q_a_pair_history has no change_type column — origin_kind is the closest
    // provenance signal (matches toRevisionBlob in qa-revision-history.tsx:54).
    changeType: row.origin_kind,
    // No change_summary column on the Q&A history table (matches toRevisionBlob:57).
    changeSummary: null,
    // changed_at is the Q&A history timestamp column (equivalent to created_at on
    // content_history — matches toRevisionBlob:58).
    createdAt: row.changed_at,
    createdByLabel,
    editIntent: row.edit_intent,
    // No binary field: Q&A pairs are text-only substrates.
  };
}
