'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
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
    },
  });

  // ─── Load a specific past digest (Task 5: route through fetchQuery) ───

  const loadDigest = async (digestId: string) => {
    // Check if already in past digests with full data
    const match = pastDigests.find((d) => d.id === digestId);
    if (match && 'domain_summaries' in match && 'narrative_summary' in match) {
      queryClient.setQueryData(queryKeys.digests.latest, match as Digest);
      return;
    }

    // Route through queryClient.fetchQuery so the result is cached
    // and subsequent loads for the same digest skip the network call.
    const digest = await queryClient.fetchQuery({
      queryKey: queryKeys.digests.detail(digestId),
      queryFn: async () => {
        // Try the list endpoint first (may have full data at wider limit)
        const listData = await fetchJson<{ digests: Digest[] }>(
          '/api/digest/list?limit=50&offset=0',
        );
        const full = listData.digests?.find((d) => d.id === digestId);
        if (full) return full;

        // Individual digest not in list — this path would need an endpoint
        // For now, return null to avoid a broken fetch
        return null;
      },
    });

    if (digest) {
      queryClient.setQueryData(queryKeys.digests.latest, digest);
    }
  };

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
