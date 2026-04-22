'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SelectionState } from './types';

/**
 * Shared selection-state hook for content listing surfaces.
 *
 * Manages a `Set<string>` of selected IDs with toggle, toggle-all, clear,
 * and auto-reset when filter dependencies change.
 *
 * @param resetDeps - array of values that trigger selection reset (e.g. filter values)
 */
export function useContentSelection(resetDeps: unknown[]): SelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((allIds: string[]) => {
    setSelectedIds((prev) => {
      if (prev.size === allIds.length && allIds.length > 0) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = useCallback(
    (totalCount: number) => {
      return selectedIds.size === totalCount && totalCount > 0;
    },
    [selectedIds.size],
  );

  // Clear selection when filter dependencies change
  useEffect(() => {
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetDeps is a dynamic array from the parent
  }, resetDeps);

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isAllSelected,
  };
}
