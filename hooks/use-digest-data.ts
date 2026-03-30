'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
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
 */
export function useDigestData() {
  const queryClient = useQueryClient();

  // ─── Latest digest query ───

  const {
    data: latestDigest,
    isLoading: loading,
  } = useQuery({
    queryKey: queryKeys.digests.latest,
    queryFn: async () => {
      const data = await fetchJson<{ digest: Digest | null }>(
        '/api/digest/latest',
      );
      return data.digest;
    },
  });

  // ─── Past digests list ───

  const {
    data: pastDigests = [],
    isLoading: loadingPastDigests,
  } = useQuery({
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
    mutationFn: (params: GenerateDigestParams) =>
      mutationFetchJson<DigestGenerateResponse>(
        '/api/digest/generate',
        params,
      ),
    onSuccess: (data) => {
      // Update the latest digest cache directly
      queryClient.setQueryData(queryKeys.digests.latest, data.digest);
      // Invalidate the list to pick up the new entry
      queryClient.invalidateQueries({
        queryKey: queryKeys.digests.list(10, 0),
      });
      toast.success('Report generated successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to generate report');
    },
  });

  // ─── Load a specific past digest (Task 5: route through fetchQuery) ───

  // Load a specific past digest into the "current" slot.
  // Note: no /api/digest/[id] endpoint exists, so we fetch via the list
  // endpoint with a wider limit. Results are cached via queryClient.fetchQuery.
  const loadDigest = useCallback(async (digestId: string) => {
    try {
      // Check if already in past digests with full data
      const match = pastDigests.find((d) => d.id === digestId);
      if (match && 'domain_summaries' in match && 'narrative_summary' in match) {
        queryClient.setQueryData(queryKeys.digests.latest, match as Digest);
        return;
      }

      const digest = await queryClient.fetchQuery({
        queryKey: queryKeys.digests.detail(digestId),
        queryFn: async () => {
          const listData = await fetchJson<{ digests: Digest[] }>(
            '/api/digest/list?limit=50&offset=0',
          );
          return listData.digests?.find((d) => d.id === digestId) ?? null;
        },
      });

      if (digest) {
        queryClient.setQueryData(queryKeys.digests.latest, digest);
      }
    } catch {
      toast.error('Failed to load report');
    }
  }, [pastDigests, queryClient]);

  return {
    currentDigest: latestDigest ?? null,
    pastDigests,
    loading,
    loadingPastDigests,
    generating: generateMutation.isPending,
    generateError: generateMutation.error,
    handleGenerate: generateMutation.mutate,
    loadDigest,
  };
}
