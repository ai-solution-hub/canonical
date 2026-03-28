'use client';

import { useState, useEffect } from 'react';
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
 * Uses useEffect + useState pattern consistent with existing hooks in this project.
 */
export function useReviewHistory(itemId: string | null): UseReviewHistoryReturn {
  const [history, setHistory] = useState<ReviewHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) {
      setHistory([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchHistory() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/review/history?item_id=${encodeURIComponent(itemId!)}`);

        if (cancelled) return;

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setError(body.error ?? `Failed to fetch review history (${response.status})`);
          setHistory([]);
          return;
        }

        const body = await response.json();
        if (cancelled) return;

        setHistory(body.history ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch review history');
        setHistory([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchHistory();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return { history, isLoading, error };
}
