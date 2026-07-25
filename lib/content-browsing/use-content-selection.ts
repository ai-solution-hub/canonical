'use client';

import { useState, useCallback, useEffect } from 'react';
import type { SelectionState } from './types';

/**
 * Shared selection-state hook for content listing surfaces.
 *
 * Manages a `Set<string>` of selected IDs with toggle, toggle-all, clear,
 * and auto-reset when filter dependencies change.
 *
 * Note: /browse previously held selection in plain useState with no reset.
 * Adopting this hook is an intentional UX improvement — filtered-out items
 * can no longer persist in the selection set, preventing "acted on an item
 * I can't see" accidents. Pass `[]` to preserve the legacy no-reset behaviour.
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

  /**
   * Select or clear every id in `allIds`.
   *
   * {128.19}: this deliberately takes the direction as an argument. The
   * previous form derived it by comparing `prev.size === allIds.length`, which
   * is only correct while the visible row count is frozen between two clicks.
   * It is not: a background refetch or retained placeholder data can change
   * the list underneath the user, and when it did, "deselect all" re-selected
   * everything instead of clearing — on a surface whose next action is a bulk
   * verify or bulk delete. The caller always knows the direction (the header
   * checkbox hands it over in `onCheckedChange`), so it passes it down rather
   * than having it guessed here.
   */
  const setAllSelected = useCallback((allIds: string[], selected: boolean) => {
    setSelectedIds(selected ? new Set(allIds) : new Set());
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
    setAllSelected,
    clearSelection,
    isAllSelected,
  };
}
