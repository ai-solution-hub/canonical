'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

export interface PromptPerformanceRow {
  version: number;
  prompt_id: string;
  is_active: boolean;
  change_notes: string | null;
  created_at: string;
  articles_scored: number;
  articles_passed: number;
  pass_rate: number;
  false_positive_flags: number;
  false_negative_flags: number;
  total_flags: number;
  flag_rate: number;
}

export function usePromptPerformance(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.metrics.promptPerformance(workspaceId),
    queryFn: () =>
      fetchJson<PromptPerformanceRow[]>(
        `/api/intelligence/workspaces/${workspaceId}/metrics/prompt-performance`,
      ),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}
