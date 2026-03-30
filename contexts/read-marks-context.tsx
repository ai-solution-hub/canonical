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

type ReadSource = 'manual' | 'review' | 'digest' | 'bulk';

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

const ReadMarksContext = createContext<ReadMarksContextValue | null>(null);

export function ReadMarksProvider({ children }: { children: React.ReactNode }) {
  const [readItemIds, setReadItemIds] = useState<Set<string>>(new Set());
  const readItemIdsRef = useRef<Set<string>>(readItemIds);
  const [readCount, setReadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);
  /** Track which item IDs have already been checked to avoid redundant requests */
  const checkedIdsRef = useRef<Set<string>>(new Set());

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

  // Lazy-load counts (read count + total count). No longer fetches all read mark IDs.
  const loadReadMarks = useCallback(() => {
    if (isLoaded || isLoadingRef.current) return;
    isLoadingRef.current = true;

    async function fetchCounts() {
      try {
        const res = await fetch('/api/read-marks');
        if (!res.ok) throw new Error('Failed to fetch read marks counts');
        const data = await res.json();

        if (!isMountedRef.current) {
          isLoadingRef.current = false;
          return;
        }

        setReadCount(data.read_count ?? 0);
        setTotalCount(data.total_count ?? 0);
        setIsLoaded(true);
      } catch (error) {
        console.error('Failed to fetch read marks counts:', error);
        if (isMountedRef.current) {
          setIsLoaded(true);
        }
      }
      isLoadingRef.current = false;
    }

    fetchCounts();
  }, [isLoaded]);

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
      if (!res.ok) throw new Error('Failed to check read status');
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

      // Update counts if returned
      if (data.read_count != null) setReadCount(data.read_count);
      if (data.total_count != null) setTotalCount(data.total_count);
    } catch (error) {
      console.error('Failed to check read status:', error);
      // Remove from checked so they can be retried
      for (const id of uncheckedIds) {
        checkedIdsRef.current.delete(id);
      }
    }
  }, []);

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
      if (wasNew) setReadCount((prev) => prev + 1);
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
      } catch (error) {
        console.error('Failed to mark as read:', error);
        // Rollback only if we actually added it
        if (wasNew) {
          setReadItemIds((prev) => {
            const next = new Set(prev);
            next.delete(itemId);
            return next;
          });
          setReadCount((prev) => Math.max(0, prev - 1));
        }
      }
    },
    [],
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
    // Defer count update to next microtask so wasRead is set by the updater
    if (wasRead) setReadCount((prev) => Math.max(0, prev - 1));

    try {
      const res = await fetch('/api/read-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_unread', item_id: itemId }),
      });
      if (!res.ok) throw new Error('Failed to mark as unread');
    } catch (error) {
      console.error('Failed to mark as unread:', error);
      // Rollback
      if (wasRead) {
        setReadItemIds((prev) => {
          const next = new Set(prev);
          next.add(itemId);
          return next;
        });
        setReadCount((prev) => prev + 1);
      }
    }
  }, []);

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

      setReadCount((prev) => prev + unreadIds.length);
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
        setReadCount((prev) => Math.max(0, prev - unreadIds.length));
      }
    },
    [],
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
