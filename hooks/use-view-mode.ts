import { useState, useCallback } from 'react';

type ViewMode = 'grid' | 'list';

/**
 * Shared hook for persisting grid/list view mode preference.
 * Each page can use its own localStorage key to maintain independent preferences.
 */
export function useViewMode(storageKey: string, defaultMode: ViewMode = 'grid') {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(storageKey);
        return (stored === 'grid' || stored === 'list') ? stored : defaultMode;
      } catch {
        return defaultMode;
      }
    }
    return defaultMode;
  });

  const setMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(storageKey, mode);
    } catch {
      // localStorage unavailable
    }
  }, [storageKey]);

  return { viewMode, setViewMode: setMode } as const;
}

export type { ViewMode };
