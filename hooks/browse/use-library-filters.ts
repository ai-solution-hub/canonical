'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LibraryFilters {
  domain?: string;
  source_file?: string;
  variant?: 'all' | 'standard_only' | 'advanced_only' | 'both' | 'neither';
  search?: string;
  freshness?: 'fresh' | 'aging' | 'stale' | 'expired';
  verified?: 'verified' | 'unverified';
}

export type GroupBy = 'none' | 'source' | 'domain';

// ---------------------------------------------------------------------------
// Hook: useLibraryFilters (URL search params)
// ---------------------------------------------------------------------------

export function useLibraryFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: LibraryFilters = useMemo(
    () => ({
      domain: searchParams.get('domain') || undefined,
      source_file: searchParams.get('source') || undefined,
      variant:
        (searchParams.get('variant') as LibraryFilters['variant']) || undefined,
      search: searchParams.get('q') || undefined,
      freshness:
        (searchParams.get('freshness') as LibraryFilters['freshness']) || undefined,
      verified:
        (searchParams.get('verified') as LibraryFilters['verified']) || undefined,
    }),
    [searchParams],
  );

  const groupBy: GroupBy = useMemo(
    () => (searchParams.get('group') as GroupBy) || 'none',
    [searchParams],
  );

  const setGroupBy = useCallback(
    (value: GroupBy) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'none') {
        params.delete('group');
      } else {
        params.set('group', value);
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setFilters = useCallback(
    (updates: Partial<LibraryFilters>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        const paramKey = key === 'source_file' ? 'source' : key === 'search' ? 'q' : key;
        if (value) {
          params.set(paramKey, value);
        } else {
          params.delete(paramKey);
        }
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const activeCount = [
    filters.domain,
    filters.source_file,
    filters.variant,
    filters.search,
    filters.freshness,
    filters.verified,
  ].filter(Boolean).length;

  return { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy };
}
