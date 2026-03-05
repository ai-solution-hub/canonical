'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { SearchResult } from '@/types/content';

interface SearchState {
  results: SearchResult[];
  count: number;
  isLoading: boolean;
  error: string | null;
}

export function useSearch() {
  const [state, setState] = useState<SearchState>({
    results: [],
    count: 0,
    isLoading: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (query: string, threshold = 0.35, limit = 20) => {
      if (!query.trim()) {
        setState({ results: [], count: 0, isLoading: false, error: null });
        return;
      }

      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, threshold, limit }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json();
          const code = data.code;
          if (code === 'EMBEDDING_FAILED') {
            throw new Error(
              'Search is temporarily unavailable. The embedding service could not be reached. Please try again shortly.',
            );
          }
          throw new Error(data.error || 'Search failed');
        }

        const data = await response.json();
        setState({
          results: data.results,
          count: data.count,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        }));
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return {
    ...state,
    search,
  };
}
