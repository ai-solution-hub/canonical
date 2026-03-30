'use client';

import { useCallback, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { SearchResult } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchParams {
  query: string;
  threshold: number;
  limit: number;
}

interface SearchResponse {
  results: SearchResult[];
  count: number;
}

// ---------------------------------------------------------------------------
// Mutation function
// ---------------------------------------------------------------------------

/**
 * Custom fetch for search that handles the EMBEDDING_FAILED error code
 * and supports AbortController signal.
 */
async function searchMutationFn(
  params: SearchParams,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
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

  return response.json() as Promise<SearchResponse>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Semantic search hook using TanStack Query's useMutation.
 *
 * Search is an imperative action triggered by user input (not auto-fetching),
 * so useMutation is the idiomatic choice. The AbortController is managed
 * via a ref to cancel in-flight requests when a new search starts.
 *
 * Return interface is preserved exactly for zero consumer changes.
 */
export function useSearch() {
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationFn: (params: SearchParams) => {
      // Abort previous request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      return searchMutationFn(params, controller.signal);
    },
  });

  const search = useCallback(
    async (query: string, threshold = 0.35, limit = 20) => {
      if (!query.trim()) {
        mutation.reset();
        return;
      }
      mutation.mutate({ query, threshold, limit });
    },
    [mutation],
  );

  // Derive error message string from mutation error (preserving null convention)
  const error =
    mutation.error instanceof Error ? mutation.error.message : mutation.error ? 'Search failed' : null;

  return {
    results: mutation.data?.results ?? [],
    count: mutation.data?.count ?? 0,
    isLoading: mutation.isPending,
    error,
    search,
  };
}
