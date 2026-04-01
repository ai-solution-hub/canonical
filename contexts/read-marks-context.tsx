'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';

type ReadSource = 'manual' | 'review' | 'digest' | 'bulk';

interface ReadMarkCounts {
  read_count: number;
  total_count: number;
}

interface ReadMarksContextValue {
  /** Set of content_item IDs that have been checked and are read */
  readItemIds: Set<string>;
  /** Total number of read items (server-side count, accurate even without loading all IDs) */
  readCount: number;
  /** Total number of unread items */
  unreadCount: number;
  /** Total number of items */
  totalCount: number;
  /** Whether initial counts have loaded */
  isLoaded: boolean;
  /** Check if a specific item has been read (only reliable after checkReadStatus for that ID) */
  isRead: (itemId: string) => boolean;
  /** Toggle read state for an item */
  toggleRead: (itemId: string, source?: ReadSource) => Promise<void>;
  /** Mark a single item as read */
  markRead: (itemId: string, source?: ReadSource) => Promise<void>;
  /** Mark a single item as unread */
  markUnread: (itemId: string) => Promise<void>;
  /** Mark multiple items as read */
  markBulkRead: (itemIds: string[], source?: ReadSource) => Promise<void>;
  /** Trigger loading of counts. Idempotent — skips if already loaded or loading. */
  loadReadMarks: () => void;
  /** Check read status for a batch of item IDs. Merges results into readItemIds. */
  checkReadStatus: (itemIds: string[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Fetcher for counts (used by useQuery)
// ---------------------------------------------------------------------------

async function fetchReadMarkCounts(): Promise<ReadMarkCounts> {
  const res = await fetch('/api/read-marks');
  if (!res.ok) {
    // During initial load, auth may not be established yet.
    // Return zeroes to avoid breaking the UI.
    return { read_count: 0, total_count: 0 };
  }
  const data = await res.json();
  return {
    read_count: data.read_count ?? 0,
    total_count: data.total_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Context + Provider
// ---------------------------------------------------------------------------

const ReadMarksContext = createContext<ReadMarksContextValue | null>(null);

export function ReadMarksProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Lazy-load trigger: counts are only fetched when loadReadMarks() is called
  const [countsEnabled, setCountsEnabled] = useState(false);

  const [readItemIds, setReadItemIds] = useState<Set<string>>(new Set());
  const readItemIdsRef = useRef<Set<string>>(readItemIds);
  // Local count overrides — used for optimistic updates between query refreshes
  const [countAdjustment, setCountAdjustment] = useState<{ read: number; total: number } | null>(null);
  /** Track which item IDs have already been checked to avoid redundant requests */
  const checkedIdsRef = useRef<Set<string>>(new Set());
  /** Track loaded state via ref so checkReadStatus can read it without dependency */
  const isLoadedRef = useRef(false);
  const isMountedRef = useRef(true);

  // Cleanup mounted ref
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keep ref in sync with state so toggleRead can read without impure updaters
  useEffect(() => {
    readItemIdsRef.current = readItemIds;
  }, [readItemIds]);

  // ─── Counts query (lazy, enabled by loadReadMarks) ───

  const {
    data: countsData,
    isSuccess: countsLoaded,
  } = useQuery({
    queryKey: queryKeys.readMarks.counts,
    queryFn: fetchReadMarkCounts,
    enabled: countsEnabled,
    staleTime: 60 * 1000, // 1 minute
    retry: false, // Auth errors are expected during establishment
  });

  // Derive counts: use adjustment if set (optimistic), otherwise use query data
  const serverReadCount = countsData?.read_count ?? 0;
  const serverTotalCount = countsData?.total_count ?? 0;
  const readCount = countAdjustment != null ? countAdjustment.read : serverReadCount;
  const totalCount = countAdjustment != null ? countAdjustment.total : serverTotalCount;

  // Clear adjustment when query data updates (server caught up)
  useEffect(() => {
    if (countsData) {
      setCountAdjustment(null);
    }
  }, [countsData]);

  const isLoaded = countsLoaded;

  // Keep ref in sync
  useEffect(() => {
    isLoadedRef.current = isLoaded;
  }, [isLoaded]);

  // Lazy-load trigger
  const loadReadMarks = useCallback(() => {
    setCountsEnabled(true);
  }, []);

  /**
   * Check read status for a batch of item IDs.
   * Only fetches IDs not already checked. Merges results into the readItemIds set.
   */
  const checkReadStatus = useCallback(async (itemIds: string[]) => {
    // Filter out IDs we've already checked
    const uncheckedIds = itemIds.filter((id) => !checkedIdsRef.current.has(id));
    if (uncheckedIds.length === 0) return;

    // Mark these as checked immediately to prevent duplicate requests
    for (const id of uncheckedIds) {
      checkedIdsRef.current.add(id);
    }

    try {
      const res = await fetch(
        `/api/read-marks?item_ids=${uncheckedIds.join(',')}`,
      );
      if (!res.ok) {
        // Suppress ALL non-ok responses during auth establishment.
        // Remove from checked so they can be retried once auth settles.
        for (const id of uncheckedIds) {
          checkedIdsRef.current.delete(id);
        }
        // Only log if we've previously loaded successfully (auth is established)
        if (isLoadedRef.current) {
          console.error(`Failed to check read status (${res.status})`);
        }
        return;
      }
      const data = await res.json();

      if (!isMountedRef.current) return;

      const readIds: string[] = data.read_item_ids ?? [];
      if (readIds.length > 0) {
        setReadItemIds((prev) => {
          const next = new Set(prev);
          for (const id of readIds) {
            next.add(id);
          }
          return next;
        });
      }

      // Update counts if returned — apply as adjustment so they take effect immediately
      if (data.read_count != null || data.total_count != null) {
        setCountAdjustment((prev) => ({
          read: data.read_count ?? prev?.read ?? serverReadCount,
          total: data.total_count ?? prev?.total ?? serverTotalCount,
        }));
      }
    } catch (error) {
      // Only log network errors if auth has been established (isLoaded).
      // During auth establishment, network errors are expected and silent.
      if (isLoadedRef.current) {
        console.error('Failed to check read status:', error);
      }
      // Remove from checked so they can be retried
      for (const id of uncheckedIds) {
        checkedIdsRef.current.delete(id);
      }
    }
  }, [serverReadCount, serverTotalCount]);

  const unreadCount = totalCount - readCount;

  const isRead = useCallback(
    (itemId: string) => readItemIds.has(itemId),
    [readItemIds],
  );

  const markRead = useCallback(
    async (itemId: string, source: ReadSource = 'manual') => {
      // Optimistic update — track whether this was actually a new read
      let wasNew = false;
      setReadItemIds((prev) => {
        if (prev.has(itemId)) return prev; // Already read, no-op
        wasNew = true;
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
      if (wasNew) {
        setCountAdjustment((prev) => ({
          read: (prev?.read ?? serverReadCount) + 1,
          total: prev?.total ?? serverTotalCount,
        }));
      }
      checkedIdsRef.current.add(itemId);

      try {
        const res = await fetch('/api/read-marks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mark_read',
            item_id: itemId,
            source,
          }),
        });
        if (!res.ok) throw new Error('Failed to mark as read');
        // Invalidate counts to pick up server-authoritative values
        queryClient.invalidateQueries({ queryKey: queryKeys.readMarks.counts });
      } catch (error) {
        console.error('Failed to mark as read:', error);
        // Rollback only if we actually added it
        if (wasNew) {
          setReadItemIds((prev) => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
          setCountAdjustment((prev) => ({
            read: Math.max(0, (prev?.read ?? serverReadCount) - 1),
            total: prev?.total ?? serverTotalCount,
          }));
        }
      }
    },
    [serverReadCount, serverTotalCount, queryClient],
  );

  const markUnread = useCallback(async (itemId: string) => {
    // Optimistic update — derive wasRead inside the updater to avoid stale closure
    let wasRead = false;
    setReadItemIds((prev) => {
      if (!prev.has(itemId)) return prev; // wasn't read, no-op
      wasRead = true;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    if (wasRead) {
      setCountAdjustment((prev) => ({
        read: Math.max(0, (prev?.read ?? serverReadCount) - 1),
        total: prev?.total ?? serverTotalCount,
      }));
    }

    try {
      const res = await fetch('/api/read-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_unread', item_id: itemId }),
      });
      if (!res.ok) throw new Error('Failed to mark as unread');
      queryClient.invalidateQueries({ queryKey: queryKeys.readMarks.counts });
    } catch (error) {
      console.error('Failed to mark as unread:', error);
      // Rollback
      if (wasRead) {
        setReadItemIds((prev) => {
          const next = new Set(prev);
          next.add(itemId);
          return next;
        });
        setCountAdjustment((prev) => ({
          read: (prev?.read ?? serverReadCount) + 1,
          total: prev?.total ?? serverTotalCount,
        }));
      }
    }
  }, [serverReadCount, serverTotalCount, queryClient]);

  const toggleRead = useCallback(
    async (itemId: string, source: ReadSource = 'manual') => {
      if (readItemIdsRef.current.has(itemId)) {
        await markUnread(itemId);
      } else {
        await markRead(itemId, source);
      }
    },
    [markRead, markUnread],
  );

  const markBulkRead = useCallback(
    async (itemIds: string[], source: ReadSource = 'bulk') => {
      // Derive unread IDs inside the updater to avoid stale closure over readItemIds
      let unreadIds: string[] = [];
      setReadItemIds((prev) => {
        unreadIds = itemIds.filter((id) => !prev.has(id));
        if (unreadIds.length === 0) return prev; // all already read, no-op
        const next = new Set(prev);
        for (const id of unreadIds) {
          next.add(id);
        }
        return next;
      });
      if (unreadIds.length === 0) return;

      setCountAdjustment((prev) => ({
        read: (prev?.read ?? serverReadCount) + unreadIds.length,
        total: prev?.total ?? serverTotalCount,
      }));
      for (const id of unreadIds) {
        checkedIdsRef.current.add(id);
      }

      try {
        const res = await fetch('/api/read-marks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'mark_bulk_read',
            item_ids: unreadIds,
            source,
          }),
        });
        if (!res.ok) throw new Error('Failed to bulk mark as read');
        queryClient.invalidateQueries({ queryKey: queryKeys.readMarks.counts });
      } catch (error) {
        console.error('Failed to bulk mark as read:', error);
        // Rollback
        setReadItemIds((prev) => {
          const next = new Set(prev);
          for (const id of unreadIds) {
            next.delete(id);
          }
          return next;
        });
        setCountAdjustment((prev) => ({
          read: Math.max(0, (prev?.read ?? serverReadCount) - unreadIds.length),
          total: prev?.total ?? serverTotalCount,
        }));
      }
    },
    [serverReadCount, serverTotalCount, queryClient],
  );

  const contextValue: ReadMarksContextValue = useMemo(() => ({
    readItemIds,
    readCount,
    unreadCount,
    totalCount,
    isLoaded,
    isRead,
    toggleRead,
    markRead,
    markUnread,
    markBulkRead,
    loadReadMarks,
    checkReadStatus,
  }), [
    readItemIds,
    readCount,
    unreadCount,
    totalCount,
    isLoaded,
    isRead,
    toggleRead,
    markRead,
    markUnread,
    markBulkRead,
    loadReadMarks,
    checkReadStatus,
  ]);

  return (
    <ReadMarksContext.Provider value={contextValue}>
      {children}
    </ReadMarksContext.Provider>
  );
}

export function useReadMarks(): ReadMarksContextValue {
  const ctx = useContext(ReadMarksContext);
  if (!ctx)
    throw new Error('useReadMarks must be used within ReadMarksProvider');
  return ctx;
}
