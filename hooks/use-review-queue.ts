'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type {
  ReviewQueueItem,
  ReviewProgress,
  ReviewFilters as ReviewFiltersType,
  ReviewStatsResponse,
  ReviewQueueSortField,
} from '@/types/review';
import type { QueueSortField } from '@/components/review-queue-panel';
import { useReviewShortcuts } from '@/hooks/use-review-shortcuts';

const BATCH_SIZE = 20;
const PREFETCH_THRESHOLD = 15;

interface UndoableAction {
  itemId: string;
  itemTitle: string;
  action: 'verify' | 'flag';
  previousIndex: number;
}

export interface UseReviewQueueReturn {
  // State
  queue: ReviewQueueItem[];
  currentIndex: number;
  isLoading: boolean;
  isActioning: boolean;
  hasMore: boolean;
  progress: ReviewProgress;
  filters: ReviewFiltersType;
  stats: ReviewStatsResponse | null;
  showFlagInput: boolean;
  flagDetails: string;
  showQueuePanel: boolean;
  queueSort: QueueSortField;
  announcement: string;

  // Refs
  cardRef: React.RefObject<HTMLDivElement | null>;
  flagInputRef: React.RefObject<HTMLInputElement | null>;

  // Computed
  currentItem: ReviewQueueItem | null;
  sortedQueue: ReviewQueueItem[];
  currentSortedIndex: number;

  // Handlers
  handleSelectItem: (sortedIndex: number) => void;
  handleVerify: () => Promise<void>;
  handlePublish: () => Promise<void>;
  handleFlagSubmit: (details?: string) => Promise<void>;
  handleFlag: () => void;
  handleSkip: () => void;
  handleBack: () => void;
  handleExit: () => void;
  handleEdit: () => void;
  handleFiltersChange: (newFilters: ReviewFiltersType) => void;
  handleTogglePanel: () => void;
  setShowFlagInput: (show: boolean) => void;
  setFlagDetails: (details: string) => void;
  setFilters: (filters: ReviewFiltersType) => void;
  setQueueSort: (sort: QueueSortField) => void;

  // Keyboard shortcuts
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

/**
 * Custom hook encapsulating all review queue state, data fetching, and handlers.
 *
 * Extracts the full queue workflow from ReviewContent so the component
 * is left with pure JSX rendering only.
 */
export function useReviewQueue(): UseReviewQueueReturn {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialise filters from URL search params (for shareability / back-button support)
  const initialFilters = useMemo((): ReviewFiltersType => {
    const status = searchParams.get('status');
    const domain = searchParams.getAll('domain').filter(Boolean);
    const content_type = searchParams.getAll('content_type').filter(Boolean);
    const source_file = searchParams.get('source_file');
    const source_document_id = searchParams.get('source_document_id');

    return {
      status: (['unverified', 'verified', 'flagged', 'draft', 'all'].includes(status ?? '')
        ? (status as ReviewFiltersType['status'])
        : 'unverified'),
      domain: domain.length > 0 ? domain : undefined,
      content_type: content_type.length > 0 ? content_type : undefined,
      source_file: source_file ?? undefined,
      source_document_id: source_document_id ?? undefined,
    };
    // Only compute once on mount — searchParams changes are handled by setFilters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queue state
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isActioning, setIsActioning] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  // Progress state
  const [progress, setProgress] = useState<ReviewProgress>({
    verified: 0,
    flagged: 0,
    skipped: 0,
    total: 0,
    sessionReviewed: 0,
  });

  // Filter state (initialised from URL)
  const [filters, setFilters] = useState<ReviewFiltersType>(initialFilters);

  // Sync filters to URL search params for shareability
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'unverified') {
      params.set('status', filters.status);
    }
    if (filters.domain?.length) {
      for (const d of filters.domain) {
        params.append('domain', d);
      }
    }
    if (filters.content_type?.length) {
      for (const ct of filters.content_type) {
        params.append('content_type', ct);
      }
    }
    if (filters.source_file) {
      params.set('source_file', filters.source_file);
    }
    if (filters.source_document_id) {
      params.set('source_document_id', filters.source_document_id);
    }

    const search = params.toString();
    const newPath = search ? `/review?${search}` : '/review';
    // Use replaceState to avoid polluting browser history on every filter change
    window.history.replaceState(null, '', newPath);
  }, [filters]);

  // Stats for filter counts and progress
  const [stats, setStats] = useState<ReviewStatsResponse | null>(null);

  // Flag input state
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagDetails, setFlagDetails] = useState('');

  // Queue panel state
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [queueSort, setQueueSortInternal] = useState<QueueSortField>('default');

  /** Map client-side sort field to server-side API sort parameter */
  const apiSortForQueueSort = useCallback((sort: QueueSortField): ReviewQueueSortField | undefined => {
    if (sort === 'confidence') return 'confidence_asc';
    return undefined; // Other sorts are client-side only
  }, []);

  // Track which server-side sort is active (triggers refetch)
  const [serverSort, setServerSort] = useState<ReviewQueueSortField | undefined>(undefined);

  const setQueueSort = useCallback((sort: QueueSortField) => {
    setQueueSortInternal(sort);
    const newServerSort = apiSortForQueueSort(sort);
    setServerSort(newServerSort);
  }, [apiSortForQueueSort]);

  // Undo state (tracked for potential future use, e.g. multi-undo)
  const [, setLastAction] = useState<UndoableAction | null>(null);

  // Flagged items tracking (for context summary)
  const flaggedThisSessionRef = useRef<Set<string>>(new Set());

  // Refs for focus management
  const cardRef = useRef<HTMLDivElement>(null);
  const flagInputRef = useRef<HTMLInputElement>(null);
  const isPrefetchingRef = useRef(false);

  // Announcements for screen readers
  const [announcement, setAnnouncement] = useState('');

  const currentItem = queue[currentIndex] ?? null;

  // Sorted queue for the side panel
  const sortedQueue = useMemo(() => {
    if (queueSort === 'default') return queue;

    const sorted = [...queue];
    switch (queueSort) {
      case 'flagged':
        sorted.sort((a, b) => {
          const aFlagged = a.governance_review_status === 'pending' ? 1 : 0;
          const bFlagged = b.governance_review_status === 'pending' ? 1 : 0;
          if (bFlagged !== aFlagged) return bFlagged - aFlagged;
          // Tiebreaker: default order (by index, already stable)
          return 0;
        });
        break;
      case 'domain':
        sorted.sort((a, b) => (a.primary_domain ?? '').localeCompare(b.primary_domain ?? ''));
        break;
      case 'content_type':
        sorted.sort((a, b) => (a.content_type ?? '').localeCompare(b.content_type ?? ''));
        break;
      case 'confidence':
        sorted.sort((a, b) => (b.classification_confidence ?? 0) - (a.classification_confidence ?? 0));
        break;
      case 'date':
        sorted.sort((a, b) => (b.captured_date ?? '').localeCompare(a.captured_date ?? ''));
        break;
    }
    return sorted;
  }, [queue, queueSort]);

  // Map sorted index back to real queue index
  const handleSelectItem = useCallback(
    (sortedIndex: number) => {
      const selectedItem = sortedQueue[sortedIndex];
      if (!selectedItem) return;
      const realIndex = queue.findIndex((q) => q.id === selectedItem.id);
      if (realIndex >= 0) setCurrentIndex(realIndex);
    },
    [sortedQueue, queue],
  );

  // Current item's index in sorted queue (for panel highlighting)
  const currentSortedIndex = useMemo(() => {
    if (!currentItem) return -1;
    return sortedQueue.findIndex((q) => q.id === currentItem.id);
  }, [sortedQueue, currentItem]);

  // -- Data Fetching --

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/review/stats');
      if (!res.ok) return;
      const data: ReviewStatsResponse = await res.json();
      setStats(data);
      setProgress((prev) => ({
        ...prev,
        total: data.total,
        verified: data.verified,
        flagged: data.flagged,
      }));
    } catch (err) {
      console.error('Failed to fetch review stats:', err);
    }
  }, []);

  const fetchQueue = useCallback(
    async (newCursor?: string) => {
      const params = new URLSearchParams();
      params.set('limit', String(BATCH_SIZE));
      if (filters.status) params.set('status', filters.status);
      if (filters.source_file) params.set('source_file', filters.source_file);
      if (filters.source_document_id) params.set('source_document_id', filters.source_document_id);
      if (filters.domain?.length) {
        for (const d of filters.domain) {
          params.append('domain', d);
        }
      }
      if (filters.content_type?.length) {
        for (const ct of filters.content_type) {
          params.append('content_type', ct);
        }
      }
      if (serverSort) params.set('sort', serverSort);
      if (newCursor) params.set('cursor', newCursor);

      const res = await fetch(`/api/review/queue?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Queue fetch failed: ${res.status}`);
      }
      return res.json();
    },
    [filters, serverSort],
  );

  // Initial load + reload on filter change
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      setIsLoading(true);
      setQueue([]);
      setCurrentIndex(0);
      setCursor(undefined);
      setHasMore(false);

      try {
        const data = await fetchQueue();
        if (cancelled) return;

        setQueue(data.items ?? []);
        setCursor(data.cursor);
        setHasMore(!!data.cursor);
        setProgress((prev) => ({
          ...prev,
          total: data.total ?? prev.total,
          verified: data.verified_count ?? prev.verified,
          flagged: data.flagged_count ?? prev.flagged,
          sessionReviewed: 0,
        }));
      } catch (err) {
        console.error('Failed to load review queue:', err);
        if (!cancelled) {
          toast.error('Failed to load review queue');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadInitial();
    return () => { cancelled = true; };
  }, [fetchQueue]);

  // Fetch stats on mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Prefetch next batch when approaching the end
  useEffect(() => {
    if (
      currentIndex >= PREFETCH_THRESHOLD &&
      currentIndex >= queue.length - (BATCH_SIZE - PREFETCH_THRESHOLD) &&
      hasMore &&
      cursor &&
      !isPrefetchingRef.current
    ) {
      isPrefetchingRef.current = true;

      fetchQueue(cursor)
        .then((data) => {
          const newItems = data.items ?? [];
          if (newItems.length > 0) {
            setQueue((prev) => [...prev, ...newItems]);
            setCursor(data.cursor);
            setHasMore(!!data.cursor);
          } else {
            setHasMore(false);
          }
        })
        .catch((err) => {
          console.error('Failed to prefetch next batch:', err);
        })
        .finally(() => {
          isPrefetchingRef.current = false;
        });
    }
  }, [currentIndex, queue.length, hasMore, cursor, fetchQueue]);

  // Focus management: focus the card and scroll to top after navigation
  useEffect(() => {
    if (!isLoading && currentItem) {
      // Scroll to top so the user always sees the start of the new item
      window.scrollTo({ top: 0, behavior: 'instant' });
      // Small delay to allow React to render the new card
      requestAnimationFrame(() => {
        cardRef.current?.focus({ preventScroll: true });
      });
    }
  }, [currentIndex, isLoading, currentItem]);

  // -- Undo Handler --

  const handleUndo = useCallback(
    async (undoAction: UndoableAction) => {
      try {
        const apiAction = undoAction.action === 'verify' ? 'unverify' : 'unflag';
        const res = await fetch('/api/review/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: undoAction.itemId, action: apiAction }),
        });
        if (!res.ok) throw new Error('Undo failed');

        // Roll back progress
        setProgress((prev) => ({
          ...prev,
          verified: undoAction.action === 'verify' ? prev.verified - 1 : prev.verified,
          flagged: undoAction.action === 'flag' ? prev.flagged - 1 : prev.flagged,
          sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
        }));

        // Roll back queue state if verify
        if (undoAction.action === 'verify') {
          setQueue((prev) =>
            prev.map((item) =>
              item.id === undoAction.itemId
                ? { ...item, verified_at: null, verified_by: null }
                : item,
            ),
          );
        }

        // Navigate back to the undone item
        setCurrentIndex(undoAction.previousIndex);
        setLastAction(null);

        toast.success(`Undone: ${undoAction.itemTitle}`);
      } catch (err) {
        console.error('Failed to undo review action:', err);
        toast.error('Failed to undo. Please try again.');
      }
    },
    [],
  );

  // -- Actions --

  const advanceToNext = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev < queue.length - 1) return prev + 1;
      return prev;
    });
  }, [queue.length]);

  const handleVerify = useCallback(async () => {
    if (!currentItem || isActioning) return;
    setIsActioning(true);

    const itemTitle = currentItem.title ?? currentItem.suggested_title ?? 'Item';
    const wasAlreadyVerified = !!currentItem.verified_at;
    const previousIndex = currentIndex;

    // Optimistic update
    setProgress((prev) => ({
      ...prev,
      verified: prev.verified + (wasAlreadyVerified ? 0 : 1),
      sessionReviewed: prev.sessionReviewed + 1,
    }));
    setQueue((prev) =>
      prev.map((item, i) =>
        i === currentIndex
          ? { ...item, verified_at: new Date().toISOString(), verified_by: 'current-user' }
          : item,
      ),
    );
    advanceToNext();

    setAnnouncement(
      wasAlreadyVerified
        ? `Re-verified. Item ${currentIndex + 2} of ${progress.total}. ${itemTitle}.`
        : `Verified. Item ${currentIndex + 2} of ${progress.total}. ${itemTitle}.`,
    );

    // Undo toast
    const undoAction: UndoableAction = {
      itemId: currentItem.id,
      itemTitle,
      action: 'verify',
      previousIndex,
    };
    setLastAction(undoAction);
    toast.success(`Verified: ${itemTitle}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        onClick: () => handleUndo(undoAction),
      },
    });

    try {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: currentItem.id, action: 'verify' }),
      });
      if (!res.ok) throw new Error('Verify failed');
    } catch (err) {
      console.error('Failed to verify item:', err);
      toast.error('Action failed. Check your connection and try again.');
      // Rollback the counter, the optimistic verified_at/verified_by fields, and the index
      setProgress((prev) => ({
        ...prev,
        verified: prev.verified - (wasAlreadyVerified ? 0 : 1),
        sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
      }));
      setQueue((prev) =>
        prev.map((item) =>
          item.id === currentItem.id
            ? { ...item, verified_at: null, verified_by: null }
            : item,
        ),
      );
      setCurrentIndex(previousIndex);
    } finally {
      setIsActioning(false);
    }
  }, [currentItem, isActioning, currentIndex, progress.total, advanceToNext, handleUndo]);

  const handlePublish = useCallback(async () => {
    if (!currentItem || isActioning) return;
    if (currentItem.governance_review_status !== 'draft') return;
    setIsActioning(true);

    const itemTitle = currentItem.title ?? currentItem.suggested_title ?? 'Item';

    try {
      // Publish via PATCH — set governance_review_status to null
      const res = await fetch(`/api/items/${currentItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'governance_review_status', value: null }),
      });
      if (!res.ok) throw new Error('Publish failed');

      // Optimistic: remove from queue (it's no longer a draft).
      // Compute new index inside the setQueue updater to avoid stale queue.length closure.
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== currentIndex);
        // Clamp currentIndex to the new last valid index
        const maxIndex = Math.max(0, next.length - 1);
        setCurrentIndex((idx) => Math.min(idx, maxIndex));
        return next;
      });

      toast.success(`Published: ${itemTitle}`);
      setAnnouncement(`Published. ${itemTitle} is now live.`);

      // Refresh stats
      fetchStats();
    } catch (err) {
      console.error('Failed to publish item:', err);
      toast.error('Failed to publish. Check your connection and try again.');
    } finally {
      setIsActioning(false);
    }
  }, [currentItem, isActioning, currentIndex, fetchStats]);

  const handleFlagSubmit = useCallback(
    async (details?: string) => {
      if (!currentItem || isActioning) return;
      setIsActioning(true);
      setShowFlagInput(false);
      setFlagDetails('');

      const itemTitle = currentItem.title ?? currentItem.suggested_title ?? 'Item';
      const previousIndex = currentIndex;

      // Track flagged items
      flaggedThisSessionRef.current.add(currentItem.id);

      // Optimistic update
      setProgress((prev) => ({
        ...prev,
        flagged: prev.flagged + 1,
        sessionReviewed: prev.sessionReviewed + 1,
      }));
      advanceToNext();

      setAnnouncement(
        `Flagged for review. Item ${currentIndex + 2} of ${progress.total}. ${itemTitle}.`,
      );

      // Undo toast
      const undoAction: UndoableAction = {
        itemId: currentItem.id,
        itemTitle,
        action: 'flag',
        previousIndex,
      };
      setLastAction(undoAction);
      toast.success(`Flagged: ${itemTitle}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => handleUndo(undoAction),
        },
      });

      try {
        const body: Record<string, unknown> = {
          item_id: currentItem.id,
          action: 'flag',
        };
        if (details?.trim()) {
          body.flag_details = details.trim();
        }

        const res = await fetch('/api/review/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Flag failed');
      } catch (err) {
        console.error('Failed to flag item:', err);
        toast.error('Action failed. Check your connection and try again.');
        setProgress((prev) => ({
          ...prev,
          flagged: prev.flagged - 1,
          sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
        }));
        setCurrentIndex(previousIndex);
      } finally {
        setIsActioning(false);
      }
    },
    [currentItem, isActioning, currentIndex, progress.total, advanceToNext, handleUndo],
  );

  const handleFlag = useCallback(() => {
    if (!currentItem || isActioning) return;
    setShowFlagInput(true);
    // Focus the input after render
    requestAnimationFrame(() => {
      flagInputRef.current?.focus();
    });
  }, [currentItem, isActioning]);

  const handleSkip = useCallback(() => {
    if (!currentItem || isActioning) return;
    // Guard: don't advance if already at the last item
    if (currentIndex >= queue.length - 1) return;

    advanceToNext();

    const nextTitle = queue[currentIndex + 1]?.title ?? queue[currentIndex + 1]?.suggested_title ?? 'Item';
    setAnnouncement(
      `Item ${currentIndex + 2} of ${queue.length}. ${nextTitle}.`,
    );
  }, [currentItem, isActioning, currentIndex, queue, advanceToNext]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleExit = useCallback(() => {
    router.push('/browse');
  }, [router]);

  const handleEdit = useCallback(() => {
    if (!currentItem) return;
    window.open(`/item/${currentItem.id}`, '_blank');
  }, [currentItem]);

  const handleFiltersChange = useCallback((newFilters: ReviewFiltersType) => {
    setFilters(newFilters);
  }, []);

  const handleTogglePanel = useCallback(() => {
    setShowQueuePanel((prev) => !prev);
  }, []);

  // -- Keyboard Shortcuts --

  const { showHelp, setShowHelp } = useReviewShortcuts({
    onVerify: handleVerify,
    onFlag: handleFlag,
    onSkip: handleSkip,
    onBack: handleBack,
    onExit: handleExit,
    onEdit: handleEdit,
    onTogglePanel: handleTogglePanel,
    enabled: !showFlagInput,
  });

  return {
    // State
    queue,
    currentIndex,
    isLoading,
    isActioning,
    hasMore,
    progress,
    filters,
    stats,
    showFlagInput,
    flagDetails,
    showQueuePanel,
    queueSort,
    announcement,

    // Refs
    cardRef,
    flagInputRef,

    // Computed
    currentItem,
    sortedQueue,
    currentSortedIndex,

    // Handlers
    handleSelectItem,
    handleVerify,
    handlePublish,
    handleFlagSubmit,
    handleFlag,
    handleSkip,
    handleBack,
    handleExit,
    handleEdit,
    handleFiltersChange,
    handleTogglePanel,
    setShowFlagInput,
    setFlagDetails,
    setFilters,
    setQueueSort,

    // Keyboard shortcuts
    showHelp,
    setShowHelp,
  };
}
