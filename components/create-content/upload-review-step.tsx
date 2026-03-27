'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, ExternalLink, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { QualityBadge } from '@/components/shared/quality-badge';
import { DedupWarning, type DedupMatch } from '@/components/shared/dedup-warning';
import { calculateQualityScore, type QualityScoreInput } from '@/lib/quality/quality-score';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for skip review preference */
const SKIP_REVIEW_KEY = 'kh_skip_upload_review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadReviewItem {
  id: string;
  title: string;
  contentType: string;
  classification?: {
    domain: string;
    subtopic: string;
    confidence: number | null;
  };
  aiSummary?: string;
  qualityScore?: number;
  suggestedLayer?: {
    suggestedLayer: string;
    reason: string;
    confidence: string;
  };
  warnings: string[];
  dedupMatches: DedupMatch[];
}

export interface UploadReviewStepProps {
  items: UploadReviewItem[];
  onPublish: (itemId: string) => Promise<void>;
  onPublishAll: () => Promise<void>;
  onDiscard: (itemId: string) => Promise<void>;
  onEditItem: (itemId: string) => void;
  onDismiss: () => void;
  /** Optional bulk discard handler — if not provided, falls back to per-item onDiscard */
  onDiscardAll?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Item status tracking
// ---------------------------------------------------------------------------

type ItemStatus = 'pending' | 'publishing' | 'published' | 'discarding' | 'discarded' | 'error';

interface ItemState {
  status: ItemStatus;
  error?: string;
  summaryExpanded: boolean;
  confirmDiscard: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate text to a maximum length, adding ellipsis if needed */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '\u2026';
}

/** Build a QualityScoreInput from the limited data available post-upload */
function buildQualityInput(item: UploadReviewItem): QualityScoreInput {
  return {
    freshness: 'fresh', // Just uploaded — always fresh
    classification_confidence: item.classification?.confidence ?? null,
    ai_summary: item.aiSummary ?? null,
    // These are not available from the upload response
    brief: null,
    detail: null,
    reference: null,
    citation_count: 0,
  };
}

/** Format content type for display (e.g. 'q_a_pair' -> 'Q&A Pair') */
function formatContentType(contentType: string): string {
  return contentType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Q A/, 'Q&A');
}

// ---------------------------------------------------------------------------
// Summary preview sub-component
// ---------------------------------------------------------------------------

const SUMMARY_PREVIEW_LENGTH = 200;

function SummaryPreview({
  summary,
  expanded,
  onToggle,
}: {
  summary: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const needsTruncation = summary.length > SUMMARY_PREVIEW_LENGTH;

  return (
    <div className="text-sm text-muted-foreground">
      <p>{expanded || !needsTruncation ? summary : truncateText(summary, SUMMARY_PREVIEW_LENGTH)}</p>
      {needsTruncation && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review card for a single item
// ---------------------------------------------------------------------------

function ReviewCard({
  item,
  state,
  onPublish,
  onDiscard,
  onEditItem,
  onToggleSummary,
  onToggleConfirmDiscard,
  cardRef,
}: {
  item: UploadReviewItem;
  state: ItemState;
  onPublish: () => void;
  onDiscard: () => void;
  onEditItem: () => void;
  onToggleSummary: () => void;
  onToggleConfirmDiscard: (show: boolean) => void;
  cardRef?: (el: HTMLElement | null) => void;
}) {
  const isActioning = state.status === 'publishing' || state.status === 'discarding';
  const isDone = state.status === 'published' || state.status === 'discarded';
  const qualityInput = buildQualityInput(item);
  const qualityResult = calculateQualityScore(qualityInput);

  if (isDone) return null;

  return (
    <article
      ref={cardRef}
      tabIndex={-1}
      role="article"
      aria-label={`Review: ${item.title}`}
      className="rounded-lg border border-border bg-card p-4 space-y-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      data-testid={`review-card-${item.id}`}
    >
      {/* Title and content type */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground truncate">{item.title}</h3>
        </div>
        <QualityBadge score={qualityResult} size="md" />
      </div>

      {/* Classification badges */}
      <div className="flex flex-wrap gap-1.5">
        {item.classification?.domain && (
          <Badge variant="secondary" data-testid="domain-badge">
            {item.classification.domain}
          </Badge>
        )}
        {item.classification?.subtopic && (
          <Badge variant="outline" data-testid="subtopic-badge">
            {item.classification.subtopic}
          </Badge>
        )}
        <Badge variant="outline" data-testid="content-type-badge">
          {formatContentType(item.contentType)}
        </Badge>
      </div>

      {/* AI summary preview */}
      {item.aiSummary && (
        <SummaryPreview
          summary={item.aiSummary}
          expanded={state.summaryExpanded}
          onToggle={onToggleSummary}
        />
      )}

      {/* Warnings */}
      {item.warnings.length > 0 && (
        <div className="space-y-1" data-testid="warnings-section">
          {item.warnings.map((warning, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-quality-moderate">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Dedup matches */}
      {item.dedupMatches.length > 0 && (
        <DedupWarning
          matches={item.dedupMatches}
          onViewMatch={(id) => window.open(`/item/${id}`, '_blank')}
          onDismiss={() => {}}
        />
      )}

      {/* Error message */}
      {state.status === 'error' && state.error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {state.error}
        </div>
      )}

      {/* Discard confirmation */}
      {state.confirmDiscard && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2"
          role="alert"
          aria-label="Confirm discard"
        >
          <p className="text-xs text-foreground">
            Are you sure you want to discard &ldquo;{item.title}&rdquo;? This will archive the item.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={onDiscard}
              disabled={isActioning}
              aria-label={`Confirm discard ${item.title}`}
            >
              {state.status === 'discarding' ? (
                <>
                  <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
                  Discarding...
                </>
              ) : (
                'Yes, discard'
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onToggleConfirmDiscard(false)}
              disabled={isActioning}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
        <Button
          size="sm"
          onClick={onPublish}
          disabled={isActioning}
          aria-label={`Confirm and publish ${item.title}`}
          data-testid="publish-button"
        >
          {state.status === 'publishing' ? (
            <>
              <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
              Publishing...
            </>
          ) : (
            <>
              <CheckCircle className="mr-1 size-3" aria-hidden="true" />
              Confirm &amp; publish
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={onEditItem}
          disabled={isActioning}
          aria-label={`Edit ${item.title} before publishing`}
          data-testid="edit-button"
        >
          <ExternalLink className="mr-1 size-3" aria-hidden="true" />
          Edit
        </Button>

        {!state.confirmDiscard && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onToggleConfirmDiscard(true)}
            disabled={isActioning}
            aria-label={`Discard ${item.title}`}
            data-testid="discard-button"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 size-3" aria-hidden="true" />
            Discard
          </Button>
        )}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UploadReviewStep({
  items,
  onPublish,
  onPublishAll,
  onDiscard,
  onEditItem,
  onDismiss,
  onDiscardAll,
}: UploadReviewStepProps) {
  // Track per-item state
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(() => {
    const initial: Record<string, ItemState> = {};
    for (const item of items) {
      initial[item.id] = {
        status: 'pending',
        summaryExpanded: false,
        confirmDiscard: false,
      };
    }
    return initial;
  });

  // Skip review checkbox state — read from localStorage on mount
  const [skipReview, setSkipReview] = useState(false);
  useEffect(() => {
    try {
      setSkipReview(localStorage.getItem(SKIP_REVIEW_KEY) === 'true');
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handleSkipReviewChange = useCallback((checked: boolean | 'indeterminate') => {
    const value = checked === true;
    setSkipReview(value);
    try {
      if (value) {
        localStorage.setItem(SKIP_REVIEW_KEY, 'true');
      } else {
        localStorage.removeItem(SKIP_REVIEW_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Ref for focus management after actions
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const uploadMoreRef = useRef<HTMLButtonElement>(null);
  const completionRef = useRef<HTMLDivElement>(null);

  // Count active (not published/discarded) items
  const activeItems = items.filter((item) => {
    const state = itemStates[item.id];
    return state && state.status !== 'published' && state.status !== 'discarded';
  });

  const isMultiItem = items.length > 1;
  const [publishingAll, setPublishingAll] = useState(false);
  const [discardingAll, setDiscardingAll] = useState(false);
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);

  const updateItemState = useCallback((itemId: string, updates: Partial<ItemState>) => {
    setItemStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...updates },
    }));
  }, []);

  // Focus the next active card after an item is removed, or the completion area
  const focusNextItem = useCallback((removedItemId: string) => {
    requestAnimationFrame(() => {
      // Find the next active item after the removed one
      const removedIndex = items.findIndex((i) => i.id === removedItemId);
      // Look forward first, then backward for a remaining active card
      for (let offset = 1; offset < items.length; offset++) {
        for (const dir of [1, -1]) {
          const idx = removedIndex + offset * dir;
          if (idx >= 0 && idx < items.length) {
            const candidate = items[idx];
            const ref = cardRefs.current[candidate.id];
            if (ref) {
              ref.focus();
              return;
            }
          }
        }
      }
      // No remaining cards — focus the completion area or upload-more button
      if (completionRef.current) {
        completionRef.current.focus();
      } else if (uploadMoreRef.current) {
        uploadMoreRef.current.focus();
      }
    });
  }, [items]);

  const handlePublish = useCallback(async (itemId: string) => {
    updateItemState(itemId, { status: 'publishing', error: undefined });
    try {
      await onPublish(itemId);
      updateItemState(itemId, { status: 'published' });
      focusNextItem(itemId);
    } catch (err) {
      updateItemState(itemId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to publish',
      });
    }
  }, [onPublish, updateItemState, focusNextItem]);

  const handleDiscard = useCallback(async (itemId: string) => {
    updateItemState(itemId, { status: 'discarding', error: undefined });
    try {
      await onDiscard(itemId);
      updateItemState(itemId, { status: 'discarded' });
      focusNextItem(itemId);
    } catch (err) {
      updateItemState(itemId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to discard',
        confirmDiscard: false,
      });
    }
  }, [onDiscard, updateItemState, focusNextItem]);

  const handlePublishAll = useCallback(async () => {
    setPublishingAll(true);
    try {
      await onPublishAll();
      // Mark all active items as published
      setItemStates((prev) => {
        const next = { ...prev };
        for (const item of activeItems) {
          next[item.id] = { ...next[item.id], status: 'published' };
        }
        return next;
      });
    } catch (err) {
      // Individual errors should be handled by the parent
      console.error('Publish all failed:', err);
    } finally {
      setPublishingAll(false);
    }
  }, [onPublishAll, activeItems]);

  const handleDiscardAll = useCallback(async () => {
    setDiscardingAll(true);
    try {
      if (onDiscardAll) {
        await onDiscardAll();
      } else {
        // Fall back to discarding each item individually
        await Promise.allSettled(activeItems.map((item) => onDiscard(item.id)));
      }
      // Mark all active items as discarded
      setItemStates((prev) => {
        const next = { ...prev };
        for (const item of activeItems) {
          next[item.id] = { ...next[item.id], status: 'discarded' };
        }
        return next;
      });
    } catch (err) {
      console.error('Discard all failed:', err);
    } finally {
      setDiscardingAll(false);
      setConfirmDiscardAll(false);
    }
  }, [onDiscardAll, onDiscard, activeItems]);

  // If all items have been actioned, show completion state
  if (activeItems.length === 0) {
    return (
      <div
        ref={completionRef}
        tabIndex={-1}
        role="region"
        aria-label="Upload review complete"
        className="space-y-4 text-center py-8 outline-none"
        data-testid="review-complete"
      >
        <CheckCircle className="mx-auto size-8 text-quality-good" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">All items reviewed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can upload more files or return to the knowledge base.
          </p>
        </div>
        <Button
          ref={uploadMoreRef}
          onClick={onDismiss}
          variant="outline"
          size="sm"
          data-testid="upload-more-button"
        >
          Upload more files
        </Button>

        {/* Skip review preference */}
        <div className="flex items-center justify-center gap-2 pt-2">
          <label htmlFor="skip-review-checkbox" className="flex cursor-pointer items-center gap-2">
            <Checkbox
              id="skip-review-checkbox"
              checked={skipReview}
              onCheckedChange={handleSkipReviewChange}
              data-testid="skip-review-checkbox"
            />
            <span className="text-xs text-muted-foreground">Skip review for future uploads</span>
          </label>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Review uploaded content"
      className="space-y-4"
      data-testid="upload-review-step"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Review uploaded content</h2>
          <Badge variant="secondary">{activeItems.length} item{activeItems.length !== 1 ? 's' : ''}</Badge>
        </div>
      </div>

      {/* Review cards */}
      <div className="space-y-3">
        {items.map((item) => {
          const state = itemStates[item.id];
          if (!state) return null;

          return (
            <ReviewCard
              key={item.id}
              item={item}
              state={state}
              onPublish={() => handlePublish(item.id)}
              onDiscard={() => handleDiscard(item.id)}
              onEditItem={() => onEditItem(item.id)}
              onToggleSummary={() =>
                updateItemState(item.id, { summaryExpanded: !state.summaryExpanded })
              }
              onToggleConfirmDiscard={(show) =>
                updateItemState(item.id, { confirmDiscard: show })
              }
              cardRef={(el) => {
                cardRefs.current[item.id] = el;
              }}
            />
          );
        })}
      </div>

      {/* Bulk actions for multi-item uploads */}
      {isMultiItem && activeItems.length > 1 && (
        <div
          className="sticky bottom-0 space-y-2 border-t border-border bg-background pt-3 pb-1"
          data-testid="bulk-actions"
        >
          {/* Discard all confirmation */}
          {confirmDiscardAll && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2"
              role="alert"
              aria-label="Confirm discard all"
              data-testid="discard-all-confirmation"
            >
              <p className="text-xs text-foreground">
                Are you sure you want to discard all {activeItems.length} items? This will archive them.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDiscardAll}
                  disabled={discardingAll}
                  data-testid="confirm-discard-all-button"
                >
                  {discardingAll ? (
                    <>
                      <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
                      Discarding all...
                    </>
                  ) : (
                    `Yes, discard all (${activeItems.length})`
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmDiscardAll(false)}
                  disabled={discardingAll}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {!confirmDiscardAll && (
              <Button
                onClick={() => setConfirmDiscardAll(true)}
                disabled={publishingAll || discardingAll}
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                data-testid="discard-all-button"
              >
                <Trash2 className="mr-1 size-3" aria-hidden="true" />
                {`Discard all (${activeItems.length})`}
              </Button>
            )}
            <Button
              onClick={handlePublishAll}
              disabled={publishingAll || discardingAll}
              size="sm"
              data-testid="publish-all-button"
            >
              {publishingAll ? (
                <>
                  <Loader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
                  Publishing all...
                </>
              ) : (
                `Confirm all (${activeItems.length})`
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Skip review preference */}
      <div className="flex items-center gap-2 border-t border-border pt-3">
        <label htmlFor="skip-review-active-checkbox" className="flex cursor-pointer items-center gap-2">
          <Checkbox
            id="skip-review-active-checkbox"
            checked={skipReview}
            onCheckedChange={handleSkipReviewChange}
            data-testid="skip-review-checkbox"
          />
          <span className="text-xs text-muted-foreground">Skip review for future uploads</span>
        </label>
      </div>
    </div>
  );
}
