'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';

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

interface SaveTargetEntry {
  domain_id: string;
  metric_name: 'item_count' | 'fresh_pct' | 'max_expired';
  target_value: number;
}

interface TargetsResponse {
  targets: CoverageTargetRow[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCoverageTargets() {
  const queryClient = useQueryClient();

  const query = useQuery<CoverageTargetRow[]>({
    queryKey: queryKeys.coverage.targets,
    queryFn: async () => {
      const data = await fetchJson<TargetsResponse>('/api/coverage/targets');
      return data.targets ?? [];
    },
  });

  const mutation = useMutation<TargetsResponse, Error, SaveTargetEntry[]>({
    mutationFn: (entries: SaveTargetEntry[]) =>
      mutationFetchJson<TargetsResponse>(
        '/api/coverage/targets',
        { targets: entries },
        { method: 'PUT' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.coverage.targets });
    },
  });

  const { mutateAsync: targetsMutateAsync } = mutation;

  const saveTargets = useCallback(
    async (
      entries: SaveTargetEntry[],
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        await targetsMutateAsync(entries);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Save failed',
        };
      }
    },
    [targetsMutateAsync],
  );

  return {
    targets: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    saveTargets,
    refetch: query.refetch,
  };
}
