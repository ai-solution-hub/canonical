'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useUrlFilters } from '@/lib/content-browsing';
import type { UrlFilterConfig } from '@/lib/content-browsing';

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
// URL filter config for library filters
// ---------------------------------------------------------------------------

const LIBRARY_FILTER_CONFIG: UrlFilterConfig<LibraryFilters> = {
  defaults: {
    domain: undefined,
    source_file: undefined,
    variant: undefined,
    search: undefined,
    freshness: undefined,
    verified: undefined,
  },
  paramMap: {
    source_file: 'source',
    search: 'q',
  },
  parsers: {
    domain: (raw) => raw || undefined,
    source_file: (raw) => raw || undefined,
    variant: (raw) => (raw as LibraryFilters['variant']) || undefined,
    search: (raw) => raw || undefined,
    freshness: (raw) => (raw as LibraryFilters['freshness']) || undefined,
    verified: (raw) => (raw as LibraryFilters['verified']) || undefined,
  },
};

// ---------------------------------------------------------------------------
// Hook: useLibraryFilters (thin wrapper over useUrlFilters)
// ---------------------------------------------------------------------------

export function useLibraryFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { filters, setFilters, clearFilters, activeCount } =
    useUrlFilters<LibraryFilters>(LIBRARY_FILTER_CONFIG);

  // GroupBy is library-specific state, not part of the shared filter primitive
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

  return {
    filters,
    setFilters,
    clearFilters,
    activeCount,
    groupBy,
    setGroupBy,
  };
}
