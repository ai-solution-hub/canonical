'use client';

import { useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson, ApiError } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { Digest, DigestGenerateResponse } from '@/types/digest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PastDigestEntry {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  created_at: string;
}

interface GenerateDigestParams {
  period_days: number;
  digest_type: string;
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
 * Task 5: `loadDigest` routes through `queryClient.fetchQuery` so the
 * result is cached and subsequent loads for the same digest are instant.
 *
 * OPS-23: AbortController support for cancelling in-flight generation.
 */
export function useDigestData() {
  const queryClient = useQueryClient();

  // AbortController ref for cancelling in-flight generation (OPS-23)
  const abortRef = useRef<AbortController | null>(null);

  // ─── Latest digest query ───

  const { data: latestDigest, isLoading: loading } = useQuery({
    queryKey: queryKeys.digests.latest,
    queryFn: async () => {
      const data = await fetchJson<{ digest: Digest | null }>(
        '/api/digest/latest',
      );
      return data.digest;
    },
  });

  // ─── Past digests list ───

  const { data: pastDigests = [], isLoading: loadingPastDigests } = useQuery({
    queryKey: queryKeys.digests.list(10, 0),
    queryFn: async () => {
      const data = await fetchJson<{ digests: PastDigestEntry[] }>(
        '/api/digest/list?limit=10&offset=0',
      );
      return data.digests;
    },
  });

  // ─── Generate mutation ───

  const generateMutation = useMutation({
    mutationFn: (params: GenerateDigestParams) => {
      // Create a new AbortController for each generation attempt
      const controller = new AbortController();
      abortRef.current = controller;
      return mutationFetchJson<DigestGenerateResponse>(
        '/api/digest/generate',
        params,
        { signal: controller.signal },
      );
    },
    onSuccess: (data) => {
      abortRef.current = null;
      // Update the latest digest cache directly
      queryClient.setQueryData(queryKeys.digests.latest, data.digest);
      // Invalidate the list to pick up the new entry
      queryClient.invalidateQueries({
        queryKey: queryKeys.digests.list(10, 0),
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

  // Load a specific past digest into the "current" slot via the detail endpoint.
  // Results are cached via queryClient.fetchQuery with the detail query key.
  const loadDigest = useCallback(
    async (digestId: string) => {
      try {
        const digest = await queryClient.fetchQuery({
          queryKey: queryKeys.digests.detail(digestId),
          queryFn: async () => {
            const data = await fetchJson<{ digest: Digest | null }>(
              `/api/digest/${digestId}`,
            );
            return data.digest;
          },
        });

        if (digest) {
          queryClient.setQueryData(queryKeys.digests.latest, digest);
        }
      } catch {
        toast.error('Failed to load report');
      }
    },
    [queryClient],
  );

  return {
    currentDigest: latestDigest ?? null,
    pastDigests,
    loading,
    loadingPastDigests,
    generating: generateMutation.isPending,
    generateError: generateMutation.error,
    handleGenerate: generateMutation.mutate,
    cancelGeneration,
    loadDigest,
  };
}
