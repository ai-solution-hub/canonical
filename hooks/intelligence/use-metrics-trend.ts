'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

export interface TrendDataPoint {
  date: string;
  total: number;
  passed: number;
  filtered: number;
  ratio: number;
}

export function useMetricsTrend(
  workspaceId: string,
  granularity: 'daily' | 'weekly' = 'daily',
  period: '30d' | '90d' | '180d' = '90d',
) {
  return useQuery({
    queryKey: queryKeys.intelligence.metrics.trend(workspaceId, granularity),
    queryFn: () =>
      fetchJson<TrendDataPoint[]>(
        `/api/intelligence/workspaces/${workspaceId}/metrics/trend?granularity=${granularity}&period=${period}`,
      ),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes — trend data does not change frequently
  });
}
