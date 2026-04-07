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
import type { ReviewAssignmentInfo } from '@/hooks/review/use-review-queue';

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

/** Shape of the assignments API response. */
interface AssignmentsResponse {
  assignments: Array<{
    id: string;
    notes: string | null;
    filter_domains: string[] | null;
    filter_content_types: string[] | null;
    filter_freshness: string[] | null;
    filter_date_from: string | null;
    filter_date_to: string | null;
    item_count: number | null;
    due_date: string | null;
  }>;
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
  if (filters.domain?.length) {
    for (const d of filters.domain) {
      params.append('domain', d);
    }
  }
  if (filters.content_type?.length) {
    for (const ct of filters.content_type) {
      params.append('content_type', ct);
    }
  }
  if (serverSort) params.set('sort', serverSort);
  return params;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseReviewQueueDataReturn {
  queue: ReviewQueueItem[];
  isLoading: boolean;
  hasMore: boolean;
  stats: ReviewStatsResponse | null;
  activeAssignment: ReviewAssignmentInfo | null;
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
 * All server data fetching for the review queue: queue (infinite), stats,
 * and assignments. Replaces 4 useState, 1 useCallback, 3 useEffects, 1 ref
 * from the original monolith.
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
  // Assignments
  // -----------------------------------------------------------------------

  const { data: activeAssignment = null } = useQuery<
    AssignmentsResponse,
    Error,
    ReviewAssignmentInfo | null
  >({
    queryKey: queryKeys.review.assignments,
    queryFn: () =>
      fetchJson<AssignmentsResponse>('/api/review/assignments?status=active'),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    select: (data): ReviewAssignmentInfo | null => {
      const assignment = data.assignments?.[0];
      if (!assignment) return null;
      return {
        id: assignment.id,
        notes: assignment.notes,
        filter_domains: assignment.filter_domains ?? [],
        filter_content_types: assignment.filter_content_types ?? [],
        filter_freshness: assignment.filter_freshness ?? [],
        filter_date_from: assignment.filter_date_from,
        filter_date_to: assignment.filter_date_to,
        item_count: assignment.item_count,
        due_date: assignment.due_date,
      };
    },
  });

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    queue,
    isLoading,
    hasMore,
    stats,
    activeAssignment,
    queueQuery,
    queryClient,
    queueFiltersKey,
  };
}
