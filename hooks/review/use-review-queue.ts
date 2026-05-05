'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  ReviewQueueItem,
  ReviewProgress,
  ReviewFilters as ReviewFiltersType,
  ReviewStatsResponse,
} from '@/types/review';
import { useReviewShortcuts } from '@/hooks/review/use-review-shortcuts';
import { useReviewSession } from '@/hooks/review/use-review-session';
import { useReviewQueueData } from '@/hooks/review/use-review-queue-data';
import { useReviewNavigation } from '@/hooks/review/use-review-navigation';
import { useReviewActions } from '@/hooks/review/use-review-actions';

// ---------------------------------------------------------------------------
// Types (preserved for consumer compatibility)
// ---------------------------------------------------------------------------

export interface ReviewAssignmentInfo {
  id: string;
  notes: string | null;
  filter_domains: string[];
  filter_content_types: string[];
  filter_freshness: string[];
  filter_date_from: string | null;
  filter_date_to: string | null;
  item_count: number | null;
  due_date: string | null;
}

/** @public */
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
  announcement: string;

  // Assignment
  activeAssignment: ReviewAssignmentInfo | null;

  // Refs
  cardRef: React.RefObject<HTMLDivElement | null>;
  flagInputRef: React.RefObject<HTMLInputElement | null>;

  // Computed
  currentItem: ReviewQueueItem | null;
  sortedQueue: ReviewQueueItem[];
  currentSortedIndex: number;

  // Handlers
  handleSelectItem: (sortedIndex: number) => void;
  handleVerify: (note?: string) => Promise<void>;
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

  // Keyboard shortcuts
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Orchestrator hook that composes 4 sub-hooks into the original 36-property
 * return interface. The consumer (`review-content.tsx`) requires zero changes.
 *
 * Dependency graph (no cycles):
 *   useReviewSession -> useReviewQueueData -> useReviewNavigation -> useReviewActions
 *
 * S215 W1: optional `statusOverride` arg lets the new ReviewTabs parent
 * preset the boot status to match the active tab. When omitted, behaviour
 * is identical to pre-S215 (URL `?status=` parser owns boot status).
 */
export function useReviewQueue(
  statusOverride?: import('@/types/review').ReviewStatus,
): UseReviewQueueReturn {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -------------------------------------------------------------------------
  // 1. Session state (filters, progress, UI toggles, announcements)
  // -------------------------------------------------------------------------
  const session = useReviewSession(searchParams, statusOverride);

  // -------------------------------------------------------------------------
  // 2. Server data (queue via infinite query, stats, assignments)
  // -------------------------------------------------------------------------
  const data = useReviewQueueData(session.filters, undefined);

  // -------------------------------------------------------------------------
  // 3. Navigation (index, sorting, selection, focus, prefetch)
  // -------------------------------------------------------------------------
  const nav = useReviewNavigation(data.queue, data.isLoading, data.queueQuery);

  // -------------------------------------------------------------------------
  // 4. Actions (verify, flag, publish, undo mutations)
  // -------------------------------------------------------------------------
  const actions = useReviewActions({
    queue: data.queue,
    currentIndex: nav.currentIndex,
    currentItem: nav.currentItem,
    queueFiltersKey: data.queueFiltersKey,
    queryClient: data.queryClient,
    progress: session.progress,
    setProgress: session.setProgress,
    advanceToNext: nav.advanceToNext,
    setCurrentIndex: nav.setCurrentIndex,
  });

  // -------------------------------------------------------------------------
  // Cross-hook effects
  // -------------------------------------------------------------------------

  // Sync stats into progress with Math.max guard (S126 #1)
  useEffect(() => {
    if (!data.stats) return;
    session.setProgress((prev) => ({
      ...prev,
      total: data.stats!.total,
      verified: Math.max(data.stats!.verified, prev.verified),
      flagged: Math.max(data.stats!.flagged, prev.flagged),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.stats]);

  // Sync action announcements into session announcement state
  useEffect(() => {
    if (actions.lastAnnouncement) {
      session.setAnnouncement(actions.lastAnnouncement);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.lastAnnouncement]);

  // -------------------------------------------------------------------------
  // Orchestrator-only handlers (not owned by any sub-hook)
  // -------------------------------------------------------------------------

  const handleFlag = useCallback(() => {
    if (!nav.currentItem || actions.isActioning) return;
    session.setShowFlagInput(true);
    requestAnimationFrame(() => {
      session.flagInputRef.current?.focus();
    });
  }, [nav.currentItem, actions.isActioning, session]);

  const handleExit = useCallback(() => {
    router.push('/browse');
  }, [router]);

  const handleEdit = useCallback(() => {
    if (!nav.currentItem) return;
    window.open(`/item/${nav.currentItem.id}`, '_blank');
  }, [nav.currentItem]);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  const { showHelp, setShowHelp } = useReviewShortcuts({
    onVerify: actions.handleVerify,
    onFlag: handleFlag,
    onSkip: nav.handleSkip,
    onBack: nav.handleBack,
    onExit: handleExit,
    onEdit: handleEdit,
    onTogglePanel: session.handleTogglePanel,
    enabled: !session.showFlagInput,
  });

  // -------------------------------------------------------------------------
  // Return — 34 properties as UseReviewQueueReturn
  // -------------------------------------------------------------------------

  return {
    // State
    queue: data.queue,
    currentIndex: nav.currentIndex,
    isLoading: data.isLoading,
    isActioning: actions.isActioning,
    hasMore: data.hasMore,
    progress: session.progress,
    filters: session.filters,
    stats: data.stats,
    showFlagInput: session.showFlagInput,
    flagDetails: session.flagDetails,
    showQueuePanel: session.showQueuePanel,
    announcement: session.announcement,

    // Assignment
    activeAssignment: data.activeAssignment,

    // Refs
    cardRef: nav.cardRef,
    flagInputRef: session.flagInputRef,

    // Computed
    currentItem: nav.currentItem,
    sortedQueue: nav.sortedQueue,
    currentSortedIndex: nav.currentSortedIndex,

    // Handlers
    handleSelectItem: nav.handleSelectItem,
    handleVerify: actions.handleVerify,
    handlePublish: actions.handlePublish,
    handleFlagSubmit: actions.handleFlagSubmit,
    handleFlag,
    handleSkip: nav.handleSkip,
    handleBack: nav.handleBack,
    handleExit,
    handleEdit,
    handleFiltersChange: session.handleFiltersChange,
    handleTogglePanel: session.handleTogglePanel,
    setShowFlagInput: session.setShowFlagInput,
    setFlagDetails: session.setFlagDetails,
    setFilters: session.setFilters,

    // Keyboard shortcuts
    showHelp,
    setShowHelp,
  };
}
