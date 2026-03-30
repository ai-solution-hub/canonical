'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadinessCriterion {
  name: string;
  passed: boolean;
  details: string;
}

interface QuestionIssue {
  question_number: number;
  question_title: string;
  issues: string[];
}

export interface ReadinessData {
  ready: boolean;
  summary: {
    total_questions: number;
    answered: number;
    approved: number;
    quality_checked: number;
    passing_quality: number;
  };
  criteria: ReadinessCriterion[];
  issues: QuestionIssue[];
}

interface UseBidReadinessReturn {
  readiness: ReadinessData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBidReadiness(bidId: string): UseBidReadinessReturn {
  const queryClient = useQueryClient();

  const query = useQuery<ReadinessData>({
    queryKey: queryKeys.bids.readiness(bidId),
    queryFn: () => fetchJson<ReadinessData>(`/api/bids/${bidId}/readiness`),
    enabled: !!bidId,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.bids.readiness(bidId) });
  }, [queryClient, bidId]);

  return {
    readiness: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
  };
}
