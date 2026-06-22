/**
 * content-item-revision adapter (ID-117 {117.5}, cluster A).
 *
 * Pure mapper: an ItemHistoryVersionDetail row → UnifiedRevision.
 *
 * This adapter is a PURE FUNCTION. It performs no fetch, no DB access, and
 * no diff-storage write. Callers supply a pre-fetched row (the shape that
 * fetchItemHistoryVersion returns — lib/query/fetchers.ts:118) and a
 * resolved display name for the author.
 *
 * Text projection: content_history.content (the canonical markdown body of the
 * content item revision — OQ-117-3 resolved).
 *
 * Caller convention: both blobs in a UnifiedDiff MUST share the same itemId
 * (adapters enforce same-record by construction — INV-1). This adapter does NOT
 * validate that constraint; it is the caller's responsibility to pass the
 * correct itemId for both older and newer rows.
 */

import type { UnifiedRevision } from '@/lib/diff/unified-revision';
import type { ItemHistoryVersionDetail } from '@/lib/query/fetchers';

/**
 * Map a content_history row (ItemHistoryVersionDetail shape) to a UnifiedRevision.
 *
 * @param row           - The full revision body from GET /api/items/[id]/history/[versionId].
 * @param itemId        - The content_items.id this history row belongs to. Both blobs in a
 *                        UnifiedDiff must share this value.
 * @param createdByLabel - Resolved display name for the author (caller resolves via
 *                         useDisplayNames or equivalent; this adapter is display-name-agnostic).
 */
export function contentItemRevisionToUnified(
  row: ItemHistoryVersionDetail,
  itemId: string,
  createdByLabel: string,
): UnifiedRevision {
  return {
    recordKind: 'content_item',
    recordId: itemId,
    version: row.version,
    // Text projection: content body is the diffable surface for content items
    // (canonical-markdown or user-edit depth — OQ-117-3 resolved).
    text: row.content,
    changeType: row.change_type,
    changeSummary: row.change_summary,
    createdAt: row.created_at,
    createdByLabel,
    editIntent: row.edit_intent,
    // No binary field: content items are text-only substrates.
  };
}
