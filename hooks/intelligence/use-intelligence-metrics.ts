'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

export interface RecentFlag {
  id: string;
  flag_type: 'false_positive' | 'false_negative';
  notes: string | null;
  created_at: string;
  article_title: string;
}

export interface MetricsSummary {
  total_articles: number;
  passed_articles: number;
  filtered_articles: number;
  filter_ratio: number;
  total_flags: number;
  false_positive_flags: number;
  false_negative_flags: number;
  unresolved_flags: number;
  last_poll_time: string | null;
  active_sources: number;
  sources_with_errors: number;
  recent_flags: RecentFlag[];
  period: string;
}

export function useIntelligenceMetrics(
  workspaceId: string,
  period: string = '30d',
) {
  return useQuery({
    queryKey: queryKeys.intelligence.metrics.summary(workspaceId, period),
    queryFn: () =>
      fetchJson<MetricsSummary>(
        `/api/intelligence/workspaces/${workspaceId}/metrics?period=${period}`,
      ),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  });
}
