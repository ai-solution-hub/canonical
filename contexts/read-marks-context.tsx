'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { createClient } from '@/lib/supabase/client';

type ReadSource = 'manual' | 'review' | 'digest' | 'bulk';

interface ReadMarksContextValue {
  /** Set of content_item IDs that have been read */
  readItemIds: Set<string>;
  /** Total number of unread items */
  unreadCount: number;
  /** Total number of items */
  totalCount: number;
  /** Whether initial data has loaded */
  isLoaded: boolean;
  /** Check if a specific item has been read */
  isRead: (itemId: string) => boolean;
  /** Toggle read state for an item */
  toggleRead: (itemId: string, source?: ReadSource) => Promise<void>;
  /** Mark a single item as read */
  markRead: (itemId: string, source?: ReadSource) => Promise<void>;
  /** Mark a single item as unread */
  markUnread: (itemId: string) => Promise<void>;
  /** Mark multiple items as read */
  markBulkRead: (itemIds: string[], source?: ReadSource) => Promise<void>;
  /** Trigger lazy loading of read marks data. Idempotent — skips if already loaded or loading. */
  loadReadMarks: () => void;
}

const ReadMarksContext = createContext<ReadMarksContextValue | null>(null);

export function ReadMarksProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [readItemIds, setReadItemIds] = useState<Set<string>>(new Set());
  const [totalCount, setTotalCount] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const isMountedRef = useRef(true);
  const isLoadingRef = useRef(false);

  // Cleanup mounted ref
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Lazy-load read marks data. Idempotent — skips if already loaded or currently loading.
  const loadReadMarks = useCallback(() => {
    if (isLoaded || isLoadingRef.current) return;
    isLoadingRef.current = true;

    async function fetchData() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (isMountedRef.current) {
          setIsLoaded(true);
        }
        isLoadingRef.current = false;
        return;
      }

      const [readResult, countResult] = await Promise.all([
        supabase.from('read_marks').select('content_item_id'),
        supabase
          .from('content_items')
          .select('*', { count: 'exact', head: true }),
      ]);

      if (!isMountedRef.current) {
        isLoadingRef.current = false;
        return;
      }

      if (readResult.error) {
        console.error('Failed to fetch read marks:', readResult.error);
      } else {
        const ids = new Set(
          (readResult.data ?? []).map(
            (r: { content_item_id: string }) => r.content_item_id,
          ),
        );
        setReadItemIds(ids);
      }

      if (!countResult.error && countResult.count !== null) {
        setTotalCount(countResult.count ?? 0);
      }

      setIsLoaded(true);
      isLoadingRef.current = false;
    }

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [isLoaded]);

  const unreadCount = totalCount - readItemIds.size;

  const isRead = useCallback(
    (itemId: string) => readItemIds.has(itemId),
    [readItemIds],
  );

  const markRead = useCallback(
    async (itemId: string, source: ReadSource = 'manual') => {
      // Optimistic update
      setReadItemIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });

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
        // Rollback
        setReadItemIds((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      }
    },
    [],
  );

  const markUnread = useCallback(async (itemId: string) => {
    // Optimistic update
    setReadItemIds((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });

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
      setReadItemIds((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
    }
  }, []);

  const toggleRead = useCallback(
    async (itemId: string, source: ReadSource = 'manual') => {
      if (readItemIds.has(itemId)) {
        await markUnread(itemId);
      } else {
        await markRead(itemId, source);
      }
    },
    [readItemIds, markRead, markUnread],
  );

  const markBulkRead = useCallback(
    async (itemIds: string[], source: ReadSource = 'bulk') => {
      // Filter to only unread items
      const unreadIds = itemIds.filter((id) => !readItemIds.has(id));
      if (unreadIds.length === 0) return;

      // Optimistic update
      setReadItemIds((prev) => {
        const next = new Set(prev);
        for (const id of unreadIds) {
          next.add(id);
        }
        return next;
      });

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
      }
    },
    [readItemIds],
  );

  const contextValue: ReadMarksContextValue = {
    readItemIds,
    unreadCount,
    totalCount,
    isLoaded,
    isRead,
    toggleRead,
    markRead,
    markUnread,
    markBulkRead,
    loadReadMarks,
  };

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
