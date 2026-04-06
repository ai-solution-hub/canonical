'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { createClient } from '@/lib/supabase/client';
import { checkOrphanedSourceIds } from '@/lib/citations';

const EMPTY_SET = new Set<string>();

/**
 * Hook for detecting orphaned citations -- citations whose KB source content
 * has been deleted. Calls the `check_content_exists` RPC to batch-verify
 * that all referenced content items still exist.
 *
 * Returns a Set of source_id values that no longer exist in the database.
 * Returns an empty set while loading or if the check fails.
 *
 * Migrated from useState+useEffect to TanStack Query. The manual ref-based
 * cache-key deduplication is replaced by TanStack Query's native query key
 * reactivity; cancellation on unmount is handled automatically.
 *
 * @param sourceIds - Array of content item UUIDs from citations
 */
export function useCitationOrphans(sourceIds: string[]): Set<string> {
  // Derive unique, non-empty IDs and a stable cache key
  const { uniqueIds, key } = useMemo(() => {
    const ids = [...new Set(sourceIds.filter(Boolean))];
    return { uniqueIds: ids, key: ids.sort().join(',') };
  }, [sourceIds]);

  const { data } = useQuery({
    // uniqueIds is captured in the queryKey via `key` (deterministic hash of
    // sorted IDs), but TanStack's exhaustive-deps lint rule can't prove that
    // derivation. Include uniqueIds explicitly so the rule is satisfied and
    // the relationship is self-documenting.
    queryKey: [...queryKeys.citations.orphans(key), uniqueIds] as const,
    queryFn: async () => {
      const supabase = createClient();
      return checkOrphanedSourceIds(uniqueIds, supabase);
    },
    enabled: uniqueIds.length > 0,
  });

  if (uniqueIds.length === 0) return EMPTY_SET;

  return data ?? EMPTY_SET;
}
