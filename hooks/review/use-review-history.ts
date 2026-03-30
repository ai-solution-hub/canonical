'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type { ReviewHistoryEntry } from '@/app/api/review/history/route';

export type { ReviewHistoryEntry };

interface UseReviewHistoryReturn {
  history: ReviewHistoryEntry[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches review history for a content item from the review history API.
 *
 * Returns an empty array when `itemId` is null or empty.
 * Migrated from useState+useEffect to TanStack Query. Cancellation on
 * unmount is handled automatically by TanStack Query.
 */
export function useReviewHistory(
  itemId: string | null,
): UseReviewHistoryReturn {
  const {
    data: history = [],
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.review.history(itemId ?? ''),
    queryFn: () =>
      fetchJson<{ history: ReviewHistoryEntry[] }>(
        `/api/review/history?item_id=${encodeURIComponent(itemId!)}`,
      ).then((body) => body.history ?? []),
    enabled: !!itemId,
  });

  return {
    history,
    isLoading,
    error: queryError
      ? queryError instanceof Error
        ? queryError.message
        : 'Failed to fetch review history'
      : null,
  };
}
