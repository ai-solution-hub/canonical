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

// Stable empty-array reference — inline `[]` on each render would create a
// new reference and break downstream `useMemo`/dep-array stability
// (CLAUDE.md UI / Frontend gotcha).
const EMPTY_RESULTS: PreviewResult[] = [];

/** @public */
export interface UseDebouncedPreviewOptions {
  /** Minimum query length to trigger a preview fetch. Default: PREVIEW_MIN_QUERY_LENGTH (3) */
  minLength?: number;
  /** Debounce interval in ms. Default: PREVIEW_DEBOUNCE_MS (300) */
  debounceMs?: number;
  /**
   * External gate. When `false`, the hook never fetches regardless of
   * `query.length >= minLength`. Used by the SearchBar to tie preview
   * lifecycle to focus + variant (inline-only). Default: `true`.
   */
  enabled?: boolean;
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
  const externallyEnabled = options?.enabled ?? true;

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

  const enabled = externallyEnabled && debouncedQuery.length >= minLength;

  const { data, isLoading: tanstackIsLoading } = useQuery<PreviewResponse>({
    queryKey: queryKeys.search.preview(debouncedQuery),
    queryFn: async ({ signal }) => {
      const url = `/api/search/preview?q=${encodeURIComponent(debouncedQuery)}&limit=${PREVIEW_MAX_RESULTS}`;
      const res = await fetch(url, { signal });
      if (!res.ok) {
        throw new Error(`Preview fetch failed: ${res.status}`);
      }
      return res.json() as Promise<PreviewResponse>;
    },
    enabled,
    staleTime: 30_000,
  });

  return {
    results: enabled && data ? data.results : EMPTY_RESULTS,
    isLoading: enabled ? tanstackIsLoading : false,
  };
}
