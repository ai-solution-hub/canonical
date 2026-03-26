'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoverageTargetRow {
  id: string;
  domain_id: string;
  metric_name: 'item_count' | 'fresh_pct' | 'max_expired';
  target_value: number;
  domain_name: string | null;
}

interface CoverageTargetsState {
  targets: CoverageTargetRow[];
  loading: boolean;
  error: string | null;
}

interface SaveTargetEntry {
  domain_id: string;
  metric_name: 'item_count' | 'fresh_pct' | 'max_expired';
  target_value: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCoverageTargets() {
  const [state, setState] = useState<CoverageTargetsState>({
    targets: [],
    loading: true,
    error: null,
  });

  const fetchTargets = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const res = await fetch('/api/coverage/targets');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load targets (${res.status})`);
      }

      const json = await res.json();
      setState({
        targets: json.targets ?? [],
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load targets',
      }));
    }
  }, []);

  useEffect(() => {
    fetchTargets();
  }, [fetchTargets]);

  const saveTargets = useCallback(
    async (entries: SaveTargetEntry[]): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/coverage/targets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: entries }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { success: false, error: body.error || `Save failed (${res.status})` };
        }

        // Refetch after successful save
        await fetchTargets();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Save failed',
        };
      }
    },
    [fetchTargets],
  );

  return {
    targets: state.targets,
    loading: state.loading,
    error: state.error,
    saveTargets,
    refetch: fetchTargets,
  };
}
