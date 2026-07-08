'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import {
  useContentSelection,
  useContentBulkRunner,
  type BulkProgress,
} from '@/lib/content-browsing';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseLibraryBulkActionsParams {
  items: ContentListItem[];
  filterDeps: unknown[];
  /** @deprecated No longer needed — bulk actions invalidate queries directly */
  onRefetch?: () => void;
}

/**
 * ID-139 {139.9}: Reclassify/Tag/Assign/Delete were retired — they targeted
 * the deleted `/api/items/*` tree (ID-131 {131.17} removed the `content_items`
 * model). No live 1:1 replacement exists on the current `q_a_pairs` model
 * (per-pair bulk-actions parity is deferred to id-135 {135.22}). Only Verify
 * (`/api/review/action`) is live, so this hook narrows to selection state +
 * Verify.
 *
 * @public
 */
export interface UseLibraryBulkActionsReturn {
  // Selection state
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;

  // Bulk operation state
  bulkOperating: boolean;
  bulkProgress: BulkProgress;

  // Bulk action handlers
  handleBulkVerify: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLibraryBulkActions({
  items,
  filterDeps,
}: UseLibraryBulkActionsParams): UseLibraryBulkActionsReturn {
  // Shared selection state — delegates to lib/content-browsing
  const {
    selectedIds,
    toggleSelect,
    toggleSelectAll: sharedToggleSelectAll,
    clearSelection,
  } = useContentSelection(filterDeps);

  // Shared bulk runner — delegates to lib/content-browsing
  const { bulkOperating, bulkProgress, runBulkOperation } =
    useContentBulkRunner<ContentListItem>(queryKeys.contentItems.all);

  // Adapt toggleSelectAll to close over items (preserves existing public API)
  const toggleSelectAll = useCallback(() => {
    sharedToggleSelectAll(items.map((i) => i.id));
  }, [items, sharedToggleSelectAll]);

  // Wrapper: run bulk op with selection clearing after
  const runWithClear = useCallback(
    async (
      label: string,
      operation: (id: string, item?: ContentListItem) => Promise<boolean>,
    ) => {
      const ids = Array.from(selectedIds);
      const count = await runBulkOperation(label, ids, operation);
      clearSelection();
      return count;
    },
    [selectedIds, runBulkOperation, clearSelection],
  );

  // Bulk verify
  const handleBulkVerify = useCallback(async () => {
    const count = await runWithClear('Verifying', async (id) => {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, action: 'verify' }),
      });
      return res.ok;
    });
    toast.success(`Verified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runWithClear]);

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    bulkOperating,
    bulkProgress,
    handleBulkVerify,
  };
}
