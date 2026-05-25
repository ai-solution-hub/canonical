'use client';

import { useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson, ApiError } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type {
  ChangeReport,
  ChangeReportGenerateResponse,
} from '@/types/change-reports';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @public */
export interface PastChangeReportEntry {
  id: string;
  frequency: string;
  period_start: string;
  period_end: string;
  item_count: number;
  created_at: string;
}

interface GenerateChangeReportParams {
  period_days: number;
  frequency: string;
  date_from?: string;
  date_to?: string;
  domain?: string;
  keywords?: string[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages digest (change report) data and mutations.
 *
 * Replaces the manual fetch/setState/useEffect pattern in the digest page
 * with TanStack Query for caching, deduplication, and automatic refetch.
 *
 * Task 5: `loadChangeReport` routes through `queryClient.fetchQuery` so the
 * result is cached and subsequent loads for the same digest are instant.
 *
 * OPS-23: AbortController support for cancelling in-flight generation.
 */
export function useChangeReportsData() {
  const queryClient = useQueryClient();

  // AbortController ref for cancelling in-flight generation (OPS-23)
  const abortRef = useRef<AbortController | null>(null);

  // ─── Latest digest query ───

  const { data: latestChangeReport, isLoading: loading } = useQuery({
    queryKey: queryKeys.changeReports.latest,
    queryFn: async () => {
      const data = await fetchJson<{ digest: ChangeReport | null }>(
        '/api/change-reports/latest',
      );
      return data.digest;
    },
  });

  // ─── Past change reports list ───

  const { data: pastChangeReports = [], isLoading: loadingPastChangeReports } =
    useQuery({
      queryKey: queryKeys.changeReports.list(10, 0),
      queryFn: async () => {
        const data = await fetchJson<{ digests: PastChangeReportEntry[] }>(
          '/api/change-reports/list?limit=10&offset=0',
        );
        return data.digests;
      },
    });

  // ─── Generate mutation ───

  const generateMutation = useMutation({
    mutationFn: (params: GenerateChangeReportParams) => {
      // Create a new AbortController for each generation attempt
      const controller = new AbortController();
      abortRef.current = controller;
      return mutationFetchJson<ChangeReportGenerateResponse>(
        '/api/change-reports/generate',
        params,
        { signal: controller.signal },
      );
    },
    onSuccess: (data) => {
      abortRef.current = null;
      // Update the latest digest cache directly
      queryClient.setQueryData(queryKeys.changeReports.latest, data.digest);
      // Invalidate the list to pick up the new entry
      queryClient.invalidateQueries({
        queryKey: queryKeys.changeReports.list(10, 0),
      });
      toast.success('Report generated successfully');
    },
    onError: (error) => {
      abortRef.current = null;
      // Don't toast on user-initiated abort
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast.info('Report generation cancelled');
        return;
      }
      // Don't toast for cost-guard errors — handled by the page component
      if (error instanceof ApiError && error.code === 'DIGEST_TOO_MANY_ITEMS') {
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate report',
      );
    },
  });

  // Cancel in-flight generation (OPS-23)
  const { reset: resetGenerateMutation } = generateMutation;
  const cancelGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    resetGenerateMutation();
  }, [resetGenerateMutation]);

  // ─── Load a specific past digest ───

  // Load a specific past change report into the "current" slot via the detail endpoint.
  // Results are cached via queryClient.fetchQuery with the detail query key.
  const loadChangeReport = useCallback(
    async (changeReportId: string) => {
      try {
        const changeReport = await queryClient.fetchQuery({
          queryKey: queryKeys.changeReports.detail(changeReportId),
          queryFn: async () => {
            const data = await fetchJson<{ digest: ChangeReport | null }>(
              `/api/change-reports/${changeReportId}`,
            );
            return data.digest;
          },
        });

        if (changeReport) {
          queryClient.setQueryData(
            queryKeys.changeReports.latest,
            changeReport,
          );
        }
      } catch {
        toast.error('Failed to load report');
      }
    },
    [queryClient],
  );

  return {
    currentChangeReport: latestChangeReport ?? null,
    pastChangeReports,
    loading,
    loadingPastChangeReports,
    generating: generateMutation.isPending,
    generateError: generateMutation.error,
    handleGenerate: generateMutation.mutate,
    cancelGeneration,
    loadChangeReport,
  };
}
