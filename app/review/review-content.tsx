'use client';

import Link from 'next/link';
import { PanelRight, CheckCircle2, Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ReviewCard } from '@/components/review-card';
import { ReviewActionBar } from '@/components/review-action-bar';
import { ReviewProgressBar } from '@/components/review-progress-bar';
import { ReviewFilters } from '@/components/review-filters';
import { ReviewQueuePanel } from '@/components/review-queue-panel';
import { useReviewQueue } from '@/hooks/use-review-queue';
import { toast } from 'sonner';
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

  // Wrap exit to show session summary toast
  const handleExitWithSummary = () => {
    const { sessionReviewed } = progress;
    if (sessionReviewed > 0) {
      toast.info(`Session complete: ${sessionReviewed} items reviewed`);
    }
    handleExit();
  };

  // -- Render States --

  // Loading skeleton
  if (isLoading) {
    return (
      <section aria-label="Content review" className="mx-auto max-w-[800px] px-4 py-8 sm:px-6">
        <div role="status" aria-label="Loading">
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
      filters.source_file;

    const allVerified = !hasFilters && progress.total > 0 && progress.verified >= progress.total;

    return (
      <section aria-label="Content review" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
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
            {allVerified ? <CheckCircle2 className="size-10" /> : <Sparkles className="size-10" />}
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
      <section aria-label="Content review" className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[800px] flex-col px-4 py-8 sm:px-6">
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
  const reviewMainContent = (
    <section aria-label="Content review" className="flex min-h-full flex-col px-4 py-8 sm:px-6">
      {/* Screen reader announcements */}
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {/* Header */}
      <div className="mx-auto w-full max-w-[800px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">Review Queue</h1>
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

        {/* Progress bar */}
        <ReviewProgressBar
          progress={progress}
          isDraft={filters.status === 'draft'}
          queuePosition={currentIndex + 1}
          queueLength={queue.length}
          className="mb-6"
        />
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
    </>
  );
}
