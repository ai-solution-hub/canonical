'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import {
  PREVIEW_DEBOUNCE_MS,
  PREVIEW_MIN_QUERY_LENGTH,
  PREVIEW_MAX_RESULTS,
} from '@/lib/search-history';

export interface PreviewResult {
  id: string;
  title: string;
  content_type: string;
  primary_domain: string | null;
}

interface PreviewResponse {
  results: PreviewResult[];
  count: number;
}

export interface UseDebouncedPreviewOptions {
  /** Minimum query length to trigger a preview fetch. Default: PREVIEW_MIN_QUERY_LENGTH (3) */
  minLength?: number;
  /** Debounce interval in ms. Default: PREVIEW_DEBOUNCE_MS (300) */
  debounceMs?: number;
  /** Max results to request. Default: PREVIEW_MAX_RESULTS (8) */
  maxResults?: number;
}

/**
 * Debounced lexical preview hook.
 *
 * Debounces the incoming query string, then fetches lightweight ilike
 * matches from `GET /api/search/preview`. Uses TanStack Query with the
 * canonical `queryKeys.search.preview(q)` key for caching/cancellation.
 *
 * AbortController propagation: TanStack Query passes its `signal` to the
 * `queryFn`, which forwards it to `fetch`. When the user keeps typing and
 * the debounced query key changes, TanStack aborts the in-flight request
 * automatically.
 */
export function useDebouncedPreview(
  query: string,
  options?: UseDebouncedPreviewOptions,
) {
  const minLength = options?.minLength ?? PREVIEW_MIN_QUERY_LENGTH;
  const debounceMs = options?.debounceMs ?? PREVIEW_DEBOUNCE_MS;
  const maxResults = options?.maxResults ?? PREVIEW_MAX_RESULTS;

  // Debounce the query string via useEffect + setTimeout
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < minLength) {
      // Schedule clear via setTimeout(0) to avoid synchronous setState
      // in the effect body (react-hooks/set-state-in-effect).
      const clearTimer = setTimeout(() => setDebouncedQuery(''), 0);
      return () => clearTimeout(clearTimer);
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query, minLength, debounceMs]);

  const enabled = debouncedQuery.length >= minLength;

  /* eslint-disable @tanstack/query/exhaustive-deps -- maxResults is
     intentionally excluded; canonical key is queryKeys.search.preview(q) per
     spec §4.1. maxResults defaults to PREVIEW_MAX_RESULTS (8) in production. */
  const { data, isLoading: tanstackIsLoading } = useQuery<PreviewResponse>({
    queryKey: queryKeys.search.preview(debouncedQuery),
    queryFn: async ({ signal }) => {
      const url = `/api/search/preview?q=${encodeURIComponent(debouncedQuery)}&limit=${maxResults}`;
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new Error(`Preview fetch failed: ${res.status}`);
      }
      return res.json() as Promise<PreviewResponse>;
    },
    enabled,
    staleTime: 30_000,
  });
  /* eslint-enable @tanstack/query/exhaustive-deps */

  return {
    results: enabled && data ? data.results : [],
    isLoading: enabled ? tanstackIsLoading : false,
  };
}
