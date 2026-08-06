'use client';

import { useMemo } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type QueryClient,
} from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type {
  ReviewFilters as ReviewFiltersType,
  ReviewQueueItem,
  ReviewQueueResponse,
  ReviewStatsResponse,
  ReviewQueueSortField,
} from '@/types/review';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single page of review queue results returned by useInfiniteQuery. */
export interface ReviewQueuePage {
  items: ReviewQueueItem[];
  total: number;
  verified_count: number;
  flagged_count: number;
  has_more: boolean;
  nextOffset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build URLSearchParams for queue API requests. */
export function buildQueueParams(
  filters: ReviewFiltersType,
  serverSort: ReviewQueueSortField | undefined,
  offset: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', String(BATCH_SIZE));
  params.set('offset', String(offset));
  if (filters.status) params.set('status', filters.status);
  if (filters.source_file) params.set('source_file', filters.source_file);
  if (filters.source_document_id)
    params.set('source_document_id', filters.source_document_id);
  if (filters.content_type?.length) {
    for (const ct of filters.content_type) {
      params.append('content_type', ct);
    }
  }
  if (filters.assigned_to_me) params.set('assigned_to_me', 'true');
  // S205 WP-E T2 — propagate "Overdue reviews" toggle to the queue route.
  // Only emit the param when on; off / undefined sends nothing so the
  // route falls through to its existing `verified_at IS NULL` predicate.
  if (filters.include_overdue) params.set('include_overdue', 'true');
  if (serverSort) params.set('sort', serverSort);
  return params;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** @public */
export interface UseReviewQueueDataReturn {
  queue: ReviewQueueItem[];
  isLoading: boolean;
  hasMore: boolean;
  stats: ReviewStatsResponse | null;
  queueQuery: UseInfiniteQueryResult<
    InfiniteData<ReviewQueuePage, number>,
    Error
  >;
  queryClient: QueryClient;
  queueFiltersKey: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * All server data fetching for the review queue: queue (infinite) and stats.
 * Replaces 4 useState, 1 useCallback, 3 useEffects, 1 ref from the original
 * monolith. (The reviewer-assignments query retired with its route — id-420.)
 */
export function useReviewQueueData(
  filters: ReviewFiltersType,
  serverSort: ReviewQueueSortField | undefined,
): UseReviewQueueDataReturn {
  const queryClient = useQueryClient();

  // Compose the queue filter key — changes trigger automatic refetch
  const queueFiltersKey = useMemo(
    () => ({ ...filters, sort: serverSort }) as Record<string, unknown>,
    [filters, serverSort],
  );

  // -----------------------------------------------------------------------
  // Queue (infinite query with offset-based pagination)
  // -----------------------------------------------------------------------

  // `queueFiltersKey = {...filters, sort: serverSort}` already encodes every
  // input the queryFn closes over. The exhaustive-deps rule cannot see
  // through the spread so we suppress with this documented justification —
  // not because deps are missing, but because they are indirect.
  /* eslint-disable @tanstack/query/exhaustive-deps -- filters and serverSort are both spread into queueFiltersKey and therefore already encoded in the queryKey */
  const queueQuery = useInfiniteQuery<
    ReviewQueuePage,
    Error,
    InfiniteData<ReviewQueuePage, number>,
    ReturnType<typeof queryKeys.review.queue>,
    number
  >({
    queryKey: queryKeys.review.queue(queueFiltersKey),
    queryFn: async ({ pageParam }): Promise<ReviewQueuePage> => {
      const params = buildQueueParams(filters, serverSort, pageParam);
      const data = await fetchJson<ReviewQueueResponse>(
        `/api/review/queue?${params.toString()}`,
      );
      return {
        ...data,
        nextOffset: pageParam + (data.items?.length ?? 0),
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.nextOffset : undefined,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  /* eslint-enable @tanstack/query/exhaustive-deps */

  // Flatten pages into a single array
  const queue = useMemo(
    () => queueQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [queueQuery.data],
  );

  const isLoading = queueQuery.isLoading;
  const hasMore = queueQuery.hasNextPage ?? false;

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  const { data: stats = null } = useQuery<ReviewStatsResponse>({
    queryKey: queryKeys.review.stats,
    queryFn: () => fetchJson<ReviewStatsResponse>('/api/review/stats'),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    queue,
    isLoading,
    hasMore,
    stats,
    queueQuery,
    queryClient,
    queueFiltersKey,
  };
}
