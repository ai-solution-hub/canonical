'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
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
 * @param sourceIds - Array of content item UUIDs from citations
 */
export function useCitationOrphans(sourceIds: string[]): Set<string> {
  const [orphanedIds, setOrphanedIds] = useState<Set<string>>(EMPTY_SET);
  const prevKeyRef = useRef<string>('');

  // Derive unique, non-empty IDs and a stable cache key outside the effect
  const { uniqueIds, key } = useMemo(() => {
    const ids = [...new Set(sourceIds.filter(Boolean))];
    return { uniqueIds: ids, key: ids.sort().join(',') };
  }, [sourceIds]);

  useEffect(() => {
    if (uniqueIds.length === 0) {
      // No IDs to check -- reset via ref guard instead of sync setState
      if (prevKeyRef.current !== '') {
        prevKeyRef.current = '';
      }
      return;
    }

    // Skip re-checking if the IDs haven't changed
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    let cancelled = false;

    async function check() {
      const supabase = createClient();
      const result = await checkOrphanedSourceIds(uniqueIds, supabase);
      if (!cancelled) {
        setOrphanedIds(result);
      }
    }

    void check();

    return () => {
      cancelled = true;
    };
  }, [uniqueIds, key]);

  // Return empty set when there are no source IDs
  if (uniqueIds.length === 0) return EMPTY_SET;

  return orphanedIds;
}
