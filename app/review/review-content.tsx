'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PanelRight, CheckCircle2, BookOpen, ClipboardList, Activity, ClipboardCheck, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ReviewCard } from '@/components/review/review-card';
import { ReviewActionBar } from '@/components/review/review-action-bar';
import { ReviewProgressBar } from '@/components/review/review-progress-bar';
import { ReviewFilters } from '@/components/review/review-filters';
import { ReviewQueuePanel } from '@/components/review/review-queue-panel';
import { ReviewSessionSummary } from '@/components/review/review-session-summary';
import type { ReviewSessionStats } from '@/components/review/review-session-summary';
import { ReviewCadenceCard } from '@/components/review/review-cadence-card';
import { useReviewQueue } from '@/hooks/review/use-review-queue';
import { useReviewHistory } from '@/hooks/review/use-review-history';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/**
 * Main client component for the Content Review page.
 * Delegates all state, data fetching, and handlers to the useReviewQueue hook.
 * This component is pure rendering only.
 */
export function ReviewContent() {
  const {
    // State
    queue,
    currentIndex,
    isLoading,
    isActioning,
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

    // Assignment
    activeAssignment,

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
  } = useReviewQueue();

  // Fetch review history for the current item
  const { history: reviewHistory, isLoading: reviewHistoryLoading } = useReviewHistory(
    currentItem?.id ?? null,
  );

  // Session summary dialog state
  const [showSummary, setShowSummary] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(0);
  // Review health cadence panel toggle
  const [showCadence, setShowCadence] = useState(false);
  const [sessionStart] = useState(() => Date.now());
  const [sessionStats, setSessionStats] = useState<ReviewSessionStats>({
    total: 0,
    verified: 0,
    flagged: 0,
    skipped: 0,
  });

  // Verify-with-note state
  const [showVerifyNote, setShowVerifyNote] = useState(false);
  const [verifyNote, setVerifyNote] = useState('');
  const verifyNoteRef = useRef<HTMLTextAreaElement>(null);

  // Track session-level verified/flagged/skipped counts independently.
  // The hook's progress.sessionReviewed tracks total actions taken this session.
  // We derive skipped from (sessionReviewed - verified - flagged) seen so far.
  const updateSessionStats = useCallback(() => {
    setSessionStats((prev) => {
      const total = progress.sessionReviewed;
      const skipped = Math.max(0, total - prev.verified - prev.flagged);
      return { total, verified: prev.verified, flagged: prev.flagged, skipped };
    });
  }, [progress.sessionReviewed]);

  // Wrap exit to show session summary dialog (or just exit if nothing reviewed)
  const handleExitWithSummary = useCallback(() => {
    const { sessionReviewed } = progress;
    if (sessionReviewed > 0) {
      updateSessionStats();
      setSessionDuration(Date.now() - sessionStart);
      setShowSummary(true);
    } else {
      handleExit();
    }
  }, [progress, handleExit, updateSessionStats, sessionStart]);

  // Close summary and navigate away
  const handleSummaryClose = useCallback((open: boolean) => {
    setShowSummary(open);
    if (!open) {
      handleExit();
    }
  }, [handleExit]);

  // Show verify note input instead of verifying immediately
  const handleVerifyClick = useCallback(() => {
    setShowVerifyNote(true);
    // Focus the textarea after rendering
    setTimeout(() => verifyNoteRef.current?.focus(), 50);
  }, []);

  // Actually verify with an optional note (tracks session stats)
  const originalHandleVerify = handleVerify;
  const handleVerifyWithNote = useCallback(async (note?: string) => {
    setShowVerifyNote(false);
    setVerifyNote('');
    setSessionStats((prev) => ({ ...prev, verified: prev.verified + 1 }));
    await originalHandleVerify(note);
  }, [originalHandleVerify]);

  // Legacy alias for action bar (it just opens the note input)
  const handleVerifyWithTracking = handleVerifyClick;

  // Wrap flag submit to track session stats
  const originalHandleFlagSubmit = handleFlagSubmit;
  const handleFlagSubmitWithTracking = useCallback(async (details?: string) => {
    setSessionStats((prev) => ({ ...prev, flagged: prev.flagged + 1 }));
    await originalHandleFlagSubmit(details);
  }, [originalHandleFlagSubmit]);

  // -- Render States --

  // Loading skeleton
  if (isLoading) {
    return (
      <section aria-label="Review queue — loading" className="mx-auto max-w-[800px] px-4 py-8 sm:px-6">
        <div role="status" aria-label="Loading review queue">
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
      </section>
    );
  }

  // Empty state
  if (queue.length === 0 || !currentItem) {
    const hasFilters =
      (filters.status && filters.status !== 'unverified') ||
      filters.domain?.length ||
      filters.content_type?.length ||
      filters.source_file ||
      filters.source_document_id;

    const allVerified = !hasFilters && progress.total > 0 && progress.verified >= progress.total;

    const emptyAriaLabel = allVerified
      ? 'Review queue — no items to review'
      : 'Review queue — no items to review';

    return (
      <section aria-label={emptyAriaLabel} className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
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
          <ReviewProgressBar
            progress={progress}
            isDraft={filters.status === 'draft'}
            queuePosition={currentIndex + 1}
            queueLength={queue.length}
            className="mb-6"
          />
        )}

        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
          <div className="mb-4 text-muted-foreground" aria-hidden="true">
            {allVerified ? <CheckCircle2 className="size-10" /> : <BookOpen className="size-10" />}
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
      </section>
    );
  }

  // Check if we've reached the end of the current queue with no more to load
  const isAtEnd = currentIndex >= queue.length;
  if (isAtEnd) {
    return (
      <section aria-label="Review queue — no items to review" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
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
      </section>
    );
  }

  // Main review content (shared between panel and non-panel layouts)
  const mainAriaLabel = `Review queue — ${queue.length} ${queue.length === 1 ? 'item' : 'items'} pending review`;
  const reviewMainContent = (
    <section aria-label={mainAriaLabel} className="flex min-h-full flex-col px-4 py-8 sm:px-6">
      {/* Screen reader announcements */}
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {/* Header */}
      <div className="mx-auto w-full max-w-[800px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              Review Queue
              {progress.flagged > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {progress.flagged} flagged
                </span>
              )}
            </h1>
            {/* Session summary indicator */}
            {progress.sessionReviewed > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  updateSessionStats();
                  setSessionDuration(Date.now() - sessionStart);
                  setShowSummary(true);
                }}
                className="gap-1.5 text-xs text-muted-foreground"
                aria-label={`Session: ${progress.sessionReviewed} reviewed. Click for summary.`}
              >
                <ClipboardList className="size-3.5" aria-hidden="true" />
                Session: {progress.sessionReviewed}
              </Button>
            )}
            {/* Review health toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCadence(!showCadence)}
              aria-label={showCadence ? 'Hide review health' : 'Show review health'}
              aria-expanded={showCadence}
              className="gap-1.5 text-xs text-muted-foreground"
            >
              <Activity className="size-3.5" aria-hidden="true" />
              Health
            </Button>
            {/* Queue panel toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleTogglePanel}
              aria-label={showQueuePanel ? 'Hide review queue panel' : 'Show review queue panel'}
              aria-expanded={showQueuePanel}
            >
              <PanelRight className="size-4" />
            </Button>
          </div>
          <ReviewFilters
            filters={filters}
            onFiltersChange={handleFiltersChange}
            stats={stats}
          />
        </div>

        {/* Review health cadence card (collapsible) */}
        {showCadence && (
          <ReviewCadenceCard className="mb-4" />
        )}

        {/* Progress bar */}
        <ReviewProgressBar
          progress={progress}
          isDraft={filters.status === 'draft'}
          queuePosition={currentIndex + 1}
          queueLength={queue.length}
          className="mb-6"
        />

        {/* Review assignment banner */}
        {activeAssignment && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3"
          >
            <ClipboardCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="flex-1 text-sm text-foreground">
              {activeAssignment.notes
                ? `You have a review assignment: ${activeAssignment.notes}`
                : 'You have a review assignment'}
              {activeAssignment.due_date && (
                <span className="ml-1 text-muted-foreground">
                  (due {new Date(activeAssignment.due_date).toLocaleDateString('en-GB')})
                </span>
              )}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              onClick={() => setFilters({ status: 'unverified' })}
            >
              <X className="size-3.5" aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        )}
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
            reviewHistory={reviewHistory}
            reviewHistoryLoading={reviewHistoryLoading}
          />
        </div>

        {/* Verify note input (inline below card, above action bar) */}
        {showVerifyNote && (
          <div className="mt-3 rounded-lg border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <label htmlFor="verify-note" className="shrink-0 pt-1.5 text-sm text-muted-foreground">
                Add a note (optional):
              </label>
              <div className="flex-1">
                <textarea
                  ref={verifyNoteRef}
                  id="verify-note"
                  value={verifyNote}
                  onChange={(e) => setVerifyNote(e.target.value.slice(0, 500))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleVerifyWithNote(verifyNote || undefined);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowVerifyNote(false);
                      setVerifyNote('');
                      cardRef.current?.focus();
                    }
                  }}
                  placeholder="Reviewer note for this verification..."
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  rows={2}
                  maxLength={500}
                />
                <div className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
                  {verifyNote.length}/500
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                className="h-8"
                onClick={() => handleVerifyWithNote(verifyNote || undefined)}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => handleVerifyWithNote(undefined)}
              >
                Skip
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setShowVerifyNote(false);
                  setVerifyNote('');
                  cardRef.current?.focus();
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

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
                  handleFlagSubmitWithTracking(flagDetails);
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
              onClick={() => handleFlagSubmitWithTracking(flagDetails)}
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
        onVerify={handleVerifyWithTracking}
        onPublish={handlePublish}
        onFlag={handleFlag}
        onSkip={handleSkip}
        onBack={handleBack}
        onExit={handleExitWithSummary}
        onEdit={handleEdit}
        onShowHelp={() => setShowHelp(true)}
        isActioning={isActioning}
        canGoBack={currentIndex > 0}
        isDraft={currentItem?.governance_review_status === 'draft'}
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
              ['\u2192', 'Next item'],
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
    </section>
  );

  // Main review view — with Sheet-based queue panel
  return (
    <>
      {reviewMainContent}

      <Sheet open={showQueuePanel} onOpenChange={handleTogglePanel} modal={false}>
        <SheetContent
          side="right"
          className="w-[320px] p-0 sm:w-[360px]"
        >
          <SheetHeader>
            <SheetTitle className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Review Queue</SheetTitle>
            <SheetDescription className="sr-only">
              Items in the current review batch
            </SheetDescription>
          </SheetHeader>
          <ReviewQueuePanel
            items={sortedQueue}
            currentIndex={currentSortedIndex}
            onSelectItem={handleSelectItem}
            sortBy={queueSort}
            onSortChange={setQueueSort}
          />
        </SheetContent>
      </Sheet>

      {/* Session summary dialog */}
      <ReviewSessionSummary
        open={showSummary}
        onOpenChange={handleSummaryClose}
        stats={sessionStats}
        sessionDuration={sessionDuration}
      />
    </>
  );
}
