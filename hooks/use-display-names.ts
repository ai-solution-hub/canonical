'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Client-side cache shared across all hook instances.
 * Maps user UUID -> display name string.
 */
const nameCache = new Map<string, string>();

/**
 * Track in-flight fetches to avoid duplicate requests.
 */
let pendingIds = new Set<string>();
let pendingPromise: Promise<void> | null = null;

async function fetchDisplayNames(ids: string[]): Promise<void> {
  // Filter out already-cached and already-pending IDs
  const needed = ids.filter(
    (id) => !nameCache.has(id) && !pendingIds.has(id),
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
        nameCache.set(id, name);
      }
    }
  } finally {
    needed.forEach((id) => pendingIds.delete(id));
    pendingPromise = null;
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

    // Check if all are already cached
    const allCached = validIds.every((id) => nameCache.has(id));
    if (allCached) {
      const cached = new Map<string, string>();
      validIds.forEach((id) => {
        const name = nameCache.get(id);
        if (name) cached.set(id, name);
      });
      setNames(cached);
      return;
    }

    // Skip if we already fetched these exact IDs
    if (idsRef.current === idsKey) return;
    idsRef.current = idsKey;

    fetchDisplayNames(validIds).then(() => {
      const resolved = new Map<string, string>();
      validIds.forEach((id) => {
        const name = nameCache.get(id);
        if (name) resolved.set(id, name);
      });
      setNames(resolved);
    });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return names;
}
