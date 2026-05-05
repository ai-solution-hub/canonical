'use client';

import { useCallback, useState } from 'react';

/**
 * Page-scoped, ephemeral multi-select state for the publication-review queue
 * (tab 6 of `/review`).
 *
 * Spec: `docs/specs/publication-approval-gate-spec.md` v1 §3.1.
 *
 * - Selection state lives entirely inside the
 *   `<PublicationReviewQueue>` component tree. Tab-switching unmounts the
 *   queue (per `review-tabs.tsx:276-278`) which clears the state via React's
 *   natural unmount — no URL mirroring, no persistence.
 * - The Set identity is replaced on every mutation (immutable update
 *   pattern: `new Set(prev)` → mutate → return) so downstream `useMemo` and
 *   `useEffect` deps that depend on selection size or membership see a
 *   referential change per toggle.
 * - All callbacks are memoised with `useCallback` so consumer components
 *   that pass them through to memoised children (e.g. the bulk action bar)
 *   don't get spurious re-renders. Per CLAUDE.md "React compiler
 *   memoisation: destructure nested properties before using in
 *   `useCallback` deps".
 */

/** @public */
export interface UsePublicationReviewSelectionResult {
  /** Currently-selected `content_items.id` values. */
  readonly selectedIds: Set<string>;
  /** Predicate: is `id` selected? */
  readonly isSelected: (id: string) => boolean;
  /** Toggle a single id's selection state. */
  readonly toggle: (id: string) => void;
  /**
   * Select-all-on-page. Replaces the set with the supplied ids — does NOT
   * union into the existing set. Per spec §3.3 the master checkbox toggles
   * **only** the page rows it can see (page-only selection per OQ-E §9.11).
   */
  readonly selectAll: (ids: string[]) => void;
  /** Clear the selection set entirely. */
  readonly clear: () => void;
}

export function usePublicationReviewSelection(): UsePublicationReviewSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const toggle = useCallback((id: string) => {
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

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  return {
    selectedIds,
    isSelected,
    toggle,
    selectAll,
    clear,
  };
}
