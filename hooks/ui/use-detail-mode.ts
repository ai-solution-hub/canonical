'use client';

import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetailMode = 'reader' | 'editor';

export interface UseDetailModeOptions {
  canEdit: boolean;
}

export interface UseDetailModeReturn {
  /** Current detail mode — 'reader' or 'editor' */
  detailMode: DetailMode;
  /** Set the detail mode explicitly */
  setDetailMode: (mode: DetailMode) => void;
  /** Toggle between reader and editor modes */
  toggleDetailMode: () => void;
  /** Convenience flag: true when in reader mode */
  isReaderMode: boolean;
  /** Convenience flag: true when in editor mode */
  isEditorMode: boolean;
  /** Whether the user can toggle between modes */
  canToggle: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'kh-detail-mode';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages reader/editor mode for the item detail page.
 *
 * - Viewers are locked to 'reader' mode — setters are no-ops.
 * - Editors default to 'editor' but can toggle to 'reader'.
 * - Preference is persisted to localStorage for editors.
 */
export function useDetailMode({
  canEdit,
}: UseDetailModeOptions): UseDetailModeReturn {
  const [detailMode, setDetailModeState] = useState<DetailMode>(() => {
    if (!canEdit) return 'reader';

    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'reader' || stored === 'editor') return stored;
      } catch {
        // localStorage unavailable — fall through to default
      }
    }

    return 'editor';
  });

  const setDetailMode = useCallback(
    (mode: DetailMode) => {
      if (!canEdit) return; // Viewers cannot change mode

      setDetailModeState(mode);
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // localStorage unavailable
      }
    },
    [canEdit],
  );

  const toggleDetailMode = useCallback(() => {
    if (!canEdit) return;

    setDetailModeState((prev) => {
      const next = prev === 'reader' ? 'editor' : 'reader';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, [canEdit]);

  return {
    detailMode: canEdit ? detailMode : 'reader',
    setDetailMode,
    toggleDetailMode,
    isReaderMode: canEdit ? detailMode === 'reader' : true,
    isEditorMode: canEdit ? detailMode === 'editor' : false,
    canToggle: canEdit,
  };
}
