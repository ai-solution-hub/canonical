import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { Digest } from '@/types/digest';

interface PastDigestEntry {
  id: string;
  digest_type: string;
  period_start: string;
  period_end: string;
  item_count: number;
  created_at: string;
}

interface LatestDigestResponse {
  digest: Digest | null;
}

interface DigestListResponse {
  digests: PastDigestEntry[];
}

interface GenerateDigestResponse {
  digest: Digest;
}

interface GenerateDigestBody {
  period_days: number;
  digest_type: string;
  date_from?: string;
  date_to?: string;
  domain?: string;
  keywords?: string[];
}

/**
 * TanStack Query hook for digest (Change Report) data.
 *
 * Replaces manual useState/useEffect/useCallback fetch patterns
 * with declarative queries and a mutation for generation.
 */
export function useDigestData() {
  const queryClient = useQueryClient();

  // Fetch the latest digest
  const latestQuery = useQuery({
    queryKey: queryKeys.digests.latest,
    queryFn: () => fetchJson<LatestDigestResponse>('/api/digest/latest'),
  });

  // Fetch list of past digests
  const pastDigestsQuery = useQuery({
    queryKey: queryKeys.digests.list(10, 0),
    queryFn: () =>
      fetchJson<DigestListResponse>('/api/digest/list?limit=10&offset=0'),
  });

  // Generate digest mutation
  const generateMutation = useMutation({
    mutationFn: (body: GenerateDigestBody) =>
      fetchJson<GenerateDigestResponse>('/api/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      // Update the latest digest in the cache
      queryClient.setQueryData(queryKeys.digests.latest, {
        digest: data.digest,
      });
      toast.success('Report generated successfully');
      // Refresh the past digests list
      queryClient.invalidateQueries({
        queryKey: queryKeys.digests.list(10, 0),
      });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      console.error('Digest generation failed:', err);
    },
  });

  // Load a specific past digest by ID
  const loadDigest = useCallback(
    async (digestId: string) => {
      const pastDigests = pastDigestsQuery.data?.digests ?? [];
      const match = pastDigests.find((d) => d.id === digestId);

      // If the past digest entry already has full data, use it directly
      if (
        match &&
        'domain_summaries' in match &&
        'narrative_summary' in match
      ) {
        queryClient.setQueryData(queryKeys.digests.latest, {
          digest: match as Digest,
        });
        return;
      }

      // Otherwise, fetch full list to find the digest
      try {
        const data = await fetchJson<DigestListResponse>(
          '/api/digest/list?limit=50&offset=0',
        );
        const full = data.digests?.find(
          (d: PastDigestEntry) => d.id === digestId,
        );
        if (full) {
          queryClient.setQueryData(queryKeys.digests.latest, {
            digest: full as Digest,
          });
        } else {
          // Digest not found in paginated list — fetch individually
          const singleData = await fetchJson<Digest>(
            `/api/digest/${digestId}`,
          );
          if (singleData) {
            queryClient.setQueryData(queryKeys.digests.latest, {
              digest: singleData,
            });
          } else {
            toast.error('Report not found');
          }
        }
      } catch (err) {
        console.error('Failed to load digest:', err);
        toast.error('Failed to load report');
      }
    },
    [pastDigestsQuery.data, queryClient],
  );

  return {
    // Current digest
    currentDigest: latestQuery.data?.digest ?? null,
    loading: latestQuery.isLoading,

    // Past digests
    pastDigests: pastDigestsQuery.data?.digests ?? [],
    loadingPastDigests: pastDigestsQuery.isLoading,

    // Generation
    generating: generateMutation.isPending,
    handleGenerate: generateMutation.mutate,

    // Load a specific digest
    loadDigest,
  };
}
