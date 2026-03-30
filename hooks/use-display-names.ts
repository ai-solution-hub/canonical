'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';

/**
 * Client-side cache shared across all hook instances.
 * Maps user UUID -> { name, cachedAt } with a 5-minute TTL.
 *
 * This module-level cache is kept alongside TanStack Query because
 * different component instances may request different ID sets.
 * The module cache lets a query for IDs [A, B] populate results
 * that a later query for IDs [A, C] can partially serve from cache.
 */
const NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const NAME_CACHE_MAX_SIZE = 200;

interface CacheEntry {
  name: string;
  cachedAt: number;
}

const nameCache = new Map<string, CacheEntry>();

function getCachedName(id: string): string | undefined {
  const entry = nameCache.get(id);
  if (!entry) return undefined;
  if (Date.now() - entry.cachedAt > NAME_CACHE_TTL_MS) {
    nameCache.delete(id);
    return undefined;
  }
  return entry.name;
}

function setCachedName(id: string, name: string): void {
  // Evict oldest entries if cache exceeds max size
  if (nameCache.size >= NAME_CACHE_MAX_SIZE) {
    const firstKey = nameCache.keys().next().value;
    if (firstKey) nameCache.delete(firstKey);
  }
  nameCache.set(id, { name, cachedAt: Date.now() });
}

/**
 * Track in-flight fetches: maps each ID to the Promise that will resolve it.
 * All callers awaiting the same ID share a single network request.
 */
const pendingFetches = new Map<string, Promise<void>>();

async function fetchDisplayNames(ids: string[]): Promise<Record<string, string>> {
  // Filter out already-cached IDs
  const needed = ids.filter((id) => getCachedName(id) === undefined);

  // Build initial result from cache
  const result: Record<string, string> = {};
  for (const id of ids) {
    const cached = getCachedName(id);
    if (cached) result[id] = cached;
  }

  if (needed.length === 0) return result;

  // For IDs already in-flight, collect their existing promises
  const existingPromises: Promise<void>[] = [];
  const toFetch: string[] = [];

  for (const id of needed) {
    const existing = pendingFetches.get(id);
    if (existing) {
      existingPromises.push(existing);
    } else {
      toFetch.push(id);
    }
  }

  // If all needed IDs are already being fetched, just await those
  if (toFetch.length === 0) {
    await Promise.all(existingPromises);
    // Build result from cache after in-flight requests complete
    for (const id of needed) {
      const cached = getCachedName(id);
      if (cached) result[id] = cached;
    }
    return result;
  }

  // Create a single promise for the batch of new IDs
  const fetchPromise = (async () => {
    try {
      const res = await fetch('/api/users/display-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toFetch }),
      });

      if (res.ok) {
        const data: Record<string, string> = await res.json();
        for (const [id, name] of Object.entries(data)) {
          setCachedName(id, name);
        }
      }
    } finally {
      // Clean up: remove our IDs from the pending map
      for (const id of toFetch) {
        pendingFetches.delete(id);
      }
    }
  })();

  // Register the promise for each ID we're fetching
  for (const id of toFetch) {
    pendingFetches.set(id, fetchPromise);
  }

  // Await both the new fetch and any existing in-flight fetches for our IDs
  await Promise.all([fetchPromise, ...existingPromises]);

  // Build final result from cache
  for (const id of needed) {
    const cached = getCachedName(id);
    if (cached) result[id] = cached;
  }

  return result;
}

/**
 * Hook that resolves user UUIDs to human-readable display names.
 *
 * Results are cached in-memory across all component instances via a
 * module-level cache. TanStack Query manages the fetch lifecycle,
 * deduplication, and stale-while-revalidate behaviour.
 *
 * Migrated from useState+useEffect to TanStack Query.
 *
 * @param userIds - array of user UUIDs to resolve
 * @returns Map from UUID to display name
 */
export function useDisplayNames(
  userIds: (string | null | undefined)[],
): Map<string, string> {
  // Filter to valid, non-null IDs and create a stable key
  const validIds = useMemo(
    () =>
      userIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    [userIds],
  );
  const idsKey = useMemo(() => [...validIds].sort().join(','), [validIds]);

  const { data } = useQuery({
    queryKey: queryKeys.displayNames.batch(idsKey),
    queryFn: () => fetchDisplayNames(validIds),
    enabled: validIds.length > 0,
    staleTime: NAME_CACHE_TTL_MS,
  });

  // Build a Map from the query data to preserve the return interface
  return useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(Object.entries(data));
  }, [data]);
}
