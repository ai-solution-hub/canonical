'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchItemProvenance } from '@/lib/query/fetchers';
import type { ItemProvenanceResponse } from '@/lib/provenance/item-provenance';

/**
 * Fetches per-item provenance data via TanStack Query.
 *
 * Admin-only — the API route returns 403 for non-admin users.
 * Disabled when `itemId` is falsy (detail drawer not open).
 */
export function useItemProvenance(itemId: string | null) {
  const query = useQuery<ItemProvenanceResponse>({
    queryKey: queryKeys.provenance.item(itemId ?? ''),
    queryFn: () => fetchItemProvenance(itemId!),
    enabled: !!itemId,
    staleTime: 30_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
