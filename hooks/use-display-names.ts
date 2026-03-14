'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Client-side cache shared across all hook instances.
 * Maps user UUID -> { name, cachedAt } with a 5-minute TTL.
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
 * Track in-flight fetches to avoid duplicate requests.
 */
const pendingIds = new Set<string>();

async function fetchDisplayNames(ids: string[]): Promise<void> {
  // Filter out already-cached and already-pending IDs
  const needed = ids.filter(
    (id) => getCachedName(id) === undefined && !pendingIds.has(id),
  );
  if (needed.length === 0) return;

  needed.forEach((id) => pendingIds.add(id));

  try {
    const res = await fetch('/api/users/display-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: needed }),
    });

    if (res.ok) {
      const data: Record<string, string> = await res.json();
      for (const [id, name] of Object.entries(data)) {
        setCachedName(id, name);
      }
    }
  } finally {
    needed.forEach((id) => pendingIds.delete(id));
  }
}

/**
 * Hook that resolves user UUIDs to human-readable display names.
 *
 * Results are cached in-memory across all component instances.
 * Returns a map from UUID -> display name (or undefined if not yet resolved).
 *
 * @param userIds - array of user UUIDs to resolve
 * @returns Map from UUID to display name
 */
export function useDisplayNames(
  userIds: (string | null | undefined)[],
): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const idsRef = useRef<string>('');

  // Filter to valid, non-null IDs
  const validIds = userIds.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  const idsKey = validIds.sort().join(',');

  useEffect(() => {
    if (validIds.length === 0) return;

    // Build map from cache for the current set of IDs
    const buildFromCache = () => {
      const map = new Map<string, string>();
      validIds.forEach((id) => {
        const name = getCachedName(id);
        if (name) map.set(id, name);
      });
      return map;
    };

    // Check if all are already cached
    const allCached = validIds.every((id) => getCachedName(id) !== undefined);
    if (allCached) {
      // Defer state update to avoid setting state directly in effect
      queueMicrotask(() => setNames(buildFromCache()));
      return;
    }

    // Skip if we already fetched these exact IDs
    if (idsRef.current === idsKey) return;
    idsRef.current = idsKey;

    fetchDisplayNames(validIds).then(() => {
      setNames(buildFromCache());
    }).catch((err) => {
      console.error('Failed to fetch display names:', err);
    });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return names;
}
