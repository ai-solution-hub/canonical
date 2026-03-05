'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { ReviewCard } from '@/components/review-card';
import { ReviewActionBar } from '@/components/review-action-bar';
import { ReviewProgressBar } from '@/components/review-progress-bar';
import { ReviewFilters } from '@/components/review-filters';
import { ReviewQueuePanel, type QueueSortField } from '@/components/review-queue-panel';
import { useReviewShortcuts } from '@/hooks/use-review-shortcuts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  ReviewQueueItem,
  ReviewProgress,
  ReviewFilters as ReviewFiltersType,
  ReviewStatsResponse,
} from '@/types/review';

const BATCH_SIZE = 20;
const PREFETCH_THRESHOLD = 15;

interface UndoableAction {
  itemId: string;
  itemTitle: string;
  action: 'verify' | 'flag';
  previousIndex: number;
}

/**
 * Main client component for the Content Review page.
 * Manages queue state, progress tracking, filters, and coordinates
 * all review sub-components.
 */
export function ReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialise filters from URL search params (for shareability / back-button support)
  const initialFilters = useMemo((): ReviewFiltersType => {
    const status = searchParams.get('status');
    const domain = searchParams.getAll('domain').filter(Boolean);
    const content_type = searchParams.getAll('content_type').filter(Boolean);
    const source_file = searchParams.get('source_file');

    return {
      status: (['unverified', 'verified', 'flagged', 'all'].includes(status ?? '')
        ? (status as ReviewFiltersType['status'])
        : 'unverified'),
      domain: domain.length > 0 ? domain : undefined,
      content_type: content_type.length > 0 ? content_type : undefined,
      source_file: source_file ?? undefined,
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
  const [queueSort, setQueueSort] = useState<QueueSortField>('default');

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
      if (newCursor) params.set('cursor', newCursor);

      const res = await fetch(`/api/review/queue?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Queue fetch failed: ${res.status}`);
      }
      return res.json();
    },
    [filters],
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

  // Focus management: focus the card after navigation
  useEffect(() => {
    if (!isLoading && currentItem) {
      // Small delay to allow React to render the new card
      requestAnimationFrame(() => {
        cardRef.current?.focus({ preventScroll: false });
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
      } catch {
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
    } catch {
      toast.error('Action failed. Check your connection and try again.');
      // Rollback the counter but not the index
      setProgress((prev) => ({
        ...prev,
        verified: prev.verified - (wasAlreadyVerified ? 0 : 1),
        sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
      }));
    } finally {
      setIsActioning(false);
    }
  }, [currentItem, isActioning, currentIndex, progress.total, advanceToNext, handleUndo]);

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
      } catch {
        toast.error('Action failed. Check your connection and try again.');
        setProgress((prev) => ({
          ...prev,
          flagged: prev.flagged - 1,
          sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
        }));
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

    const itemTitle = currentItem.title ?? currentItem.suggested_title ?? 'Item';

    setProgress((prev) => ({
      ...prev,
      skipped: prev.skipped + 1,
      sessionReviewed: prev.sessionReviewed + 1,
    }));
    advanceToNext();

    setAnnouncement(
      `Skipped. Item ${currentIndex + 2} of ${progress.total}. ${itemTitle}.`,
    );
  }, [currentItem, isActioning, currentIndex, progress.total, advanceToNext]);

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

  // -- Render States --

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="h-7 w-40 animate-pulse rounded-md bg-accent" />
            <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-accent" />
          </div>
          <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
        </div>
        <div className="mb-6 h-2 w-full animate-pulse rounded-full bg-accent" />
        {/* Card skeleton */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex gap-2">
            <div className="h-5 w-24 animate-pulse rounded-full bg-accent" />
            <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
          </div>
          <div className="mt-4 h-6 w-3/4 animate-pulse rounded bg-accent" />
          <div className="mt-6 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-accent" />
            <div className="h-4 w-full animate-pulse rounded bg-accent" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-accent" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-accent" />
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <div className="h-3 w-20 animate-pulse rounded bg-accent" />
            <div className="mt-2 h-4 w-48 animate-pulse rounded bg-accent" />
          </div>
        </div>
        <div className="mt-4 h-14 w-full animate-pulse rounded-lg bg-accent" />
      </div>
    );
  }

  // Empty state
  if (queue.length === 0 || !currentItem) {
    const hasFilters =
      (filters.status && filters.status !== 'unverified') ||
      filters.domain?.length ||
      filters.content_type?.length ||
      filters.source_file;

    const allVerified = !hasFilters && progress.total > 0 && progress.verified >= progress.total;

    return (
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Review Queue</h1>
          </div>
          <ReviewFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            stats={stats}
          />
        </div>

        {progress.total > 0 && (
          <ReviewProgressBar progress={progress} className="mb-6" />
        )}

        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
          <div className="mb-4 text-4xl" role="img" aria-label="Checkmark">
            {allVerified ? '\u2705' : '\u2728'}
          </div>
          {allVerified ? (
            <>
              <h2 className="text-lg font-semibold">
                All {progress.total.toLocaleString('en-GB')} items have been verified.
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Nice work! The knowledge base is fully reviewed.
              </p>
              <Button asChild variant="outline" className="mt-4">
                <Link href="/browse">Back to Browse</Link>
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">
                All caught up!
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                No unverified items match your filters.
              </p>
              {hasFilters && (
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => setFilters({ status: 'unverified' })}
                >
                  Clear filters
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // Check if we've reached the end of the current queue with no more to load
  const isAtEnd = currentIndex >= queue.length;
  if (isAtEnd) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Review Queue</h1>
          <ReviewFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            stats={stats}
          />
        </div>
        <ReviewProgressBar progress={progress} className="mb-6" />
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">Batch complete</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You have reviewed all items in this batch.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setFilters({ ...filters })}
          >
            Load more
          </Button>
        </div>
      </div>
    );
  }

  // Main review content (shared between panel and non-panel layouts)
  const reviewMainContent = (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col px-4 py-8 sm:px-6">
      {/* Screen reader announcements */}
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {/* Header */}
      <div className="mx-auto w-full max-w-[800px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">Review Queue</h1>
            {/* Queue panel toggle (hidden on mobile) */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleTogglePanel}
              className="hidden md:inline-flex"
              aria-label={showQueuePanel ? 'Hide review queue panel' : 'Show review queue panel'}
              aria-expanded={showQueuePanel}
            >
              {showQueuePanel ? (
                <PanelRightClose className="size-4" />
              ) : (
                <PanelRightOpen className="size-4" />
              )}
            </Button>
          </div>
          <ReviewFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            stats={stats}
          />
        </div>

        {/* Progress bar */}
        <ReviewProgressBar progress={progress} className="mb-6" />
      </div>

      {/* Content area with bottom padding for sticky action bar clearance */}
      <div className="mx-auto w-full max-w-[800px] flex-1 pb-20">
        {/* Review card with motion-safe transitions */}
        <div className="motion-safe:transition-opacity motion-safe:duration-150">
          <ReviewCard
            ref={cardRef}
            item={currentItem}
            position={currentIndex + 1}
            total={progress.total || queue.length}
          />
        </div>

        {/* Flag input (inline below card, above action bar) */}
        {showFlagInput && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
            <label htmlFor="flag-reason" className="shrink-0 text-sm text-muted-foreground">
              Reason (optional):
            </label>
            <Input
              ref={flagInputRef}
              id="flag-reason"
              value={flagDetails}
              onChange={(e) => setFlagDetails(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleFlagSubmit(flagDetails);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowFlagInput(false);
                  setFlagDetails('');
                  cardRef.current?.focus();
                }
              }}
              placeholder="Why does this need attention?"
              className="h-8 text-sm"
              maxLength={500}
            />
            <Button
              size="sm"
              className="h-8 shrink-0"
              onClick={() => handleFlagSubmit(flagDetails)}
            >
              Submit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0"
              onClick={() => {
                setShowFlagInput(false);
                setFlagDetails('');
                cardRef.current?.focus();
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <ReviewActionBar
        onVerify={handleVerify}
        onFlag={handleFlag}
        onSkip={handleSkip}
        onBack={handleBack}
        onExit={handleExit}
        onEdit={handleEdit}
        onShowHelp={() => setShowHelp(true)}
        isActioning={isActioning}
        canGoBack={currentIndex > 0}
      />

      {/* Keyboard shortcuts help dialog */}
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Available shortcuts for the Review Queue page
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {[
              ['Enter', 'Verify current item'],
              ['F', 'Flag for review'],
              ['\u2192', 'Skip to next item'],
              ['\u2190', 'Go back to previous item'],
              ['E', 'Open item in new tab for editing'],
              ['L', 'Toggle review queue panel'],
              ['Esc', 'Exit review (go to Browse)'],
              ['?', 'Toggle this help overlay'],
            ].map(([key, desc]) => (
              <div key={key} className="contents">
                <kbd className="inline-flex h-6 items-center justify-center rounded border border-border bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                  {key}
                </kbd>
                <span className="self-center text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Main review view — with optional side panel
  return (
    <PanelGroup
      orientation="horizontal"
      className="min-h-[calc(100vh-4rem)]"
    >
      <Panel
        id="review-main"
        defaultSize={showQueuePanel ? '75%' : '100%'}
        minSize="60%"
      >
        {reviewMainContent}
      </Panel>

      {showQueuePanel && (
        <>
          <PanelResizeHandle className="hidden w-1.5 bg-border transition-colors hover:bg-primary/20 data-[active]:bg-primary/30 md:block" />
          <Panel
            id="review-queue"
            defaultSize="25%"
            minSize="20%"
            maxSize="35%"
            className="hidden md:block"
          >
            <ReviewQueuePanel
              items={sortedQueue}
              currentIndex={currentSortedIndex}
              onSelectItem={handleSelectItem}
              sortBy={queueSort}
              onSortChange={setQueueSort}
            />
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
