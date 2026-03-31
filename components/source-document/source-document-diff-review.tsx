'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';
import {
  DiffHighlightedText,
  exceedsLazyThreshold,
} from '@/components/source-document/diff-highlighted-text';
import { useDiffReview } from '@/hooks/use-diff-review';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffReviewEntry {
  id: string;
  diff_type: 'added' | 'removed' | 'modified' | 'unchanged';
  diff_mode?: 'qa' | 'full_text';
  old_question?: string;
  new_question?: string;
  old_content?: string;
  new_content?: string;
  similarity_score?: number;
  section_header?: string;
  affected_item?: { id: string; title: string };
  status: string;
  reviewer_note?: string;
}

export interface SourceDocumentDiffReviewProps {
  documentId: string;
  oldDocument: {
    id: string;
    filename: string;
    version: number;
    uploaded_at: string;
  };
  newDocument: {
    id: string;
    filename: string;
    version: number;
    uploaded_at: string;
  };
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
  entries: DiffReviewEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type DiffFilter = 'all' | 'added' | 'modified' | 'removed';

const FILTER_OPTIONS: { value: DiffFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'added', label: 'Added' },
  { value: 'modified', label: 'Modified' },
  { value: 'removed', label: 'Removed' },
];

// ---------------------------------------------------------------------------
// Badge helpers — semantic tokens only, never raw Tailwind colours
// ---------------------------------------------------------------------------

function getDiffTypeBadgeClasses(diffType: DiffReviewEntry['diff_type']): {
  text: string;
  bg: string;
} {
  switch (diffType) {
    case 'added':
      return { text: 'text-quality-good', bg: 'bg-quality-good-bg' };
    case 'modified':
      return { text: 'text-freshness-aging', bg: 'bg-freshness-aging-bg' };
    case 'removed':
      return { text: 'text-destructive', bg: 'bg-destructive/10' };
    case 'unchanged':
      return { text: 'text-muted-foreground', bg: 'bg-muted' };
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending_review':
      return 'Needs Review';
    case 'applied':
      return 'Applied';
    case 'dismissed':
      return 'Dismissed';
    default:
      return status;
  }
}

function getStatusClasses(status: string): string {
  switch (status) {
    case 'pending_review':
      return 'text-freshness-aging bg-freshness-aging-bg';
    case 'applied':
      return 'text-quality-good bg-quality-good-bg';
    case 'dismissed':
      return 'text-muted-foreground bg-muted';
    default:
      return 'text-muted-foreground bg-muted';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffTypeBadge({
  diffType,
}: {
  diffType: DiffReviewEntry['diff_type'];
}) {
  const { text, bg } = getDiffTypeBadgeClasses(diffType);
  const label = diffType.charAt(0).toUpperCase() + diffType.slice(1);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        text,
        bg,
      )}
      aria-label={`Diff type: ${label}`}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = getStatusLabel(status);
  const classes = getStatusClasses(status);

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        classes,
      )}
      aria-label={`Status: ${label}`}
    >
      {label}
    </span>
  );
}

function ContentBlock({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviewer note input
// ---------------------------------------------------------------------------

const REVIEWER_NOTE_MAX_LENGTH = 500;

function ReviewerNoteInput({
  entryId,
  existingNote,
  entryStatus,
  onNoteChange,
}: {
  entryId: string;
  existingNote?: string;
  entryStatus: string;
  onNoteChange: (id: string, note: string) => void;
}) {
  const isReviewed = entryStatus === 'applied' || entryStatus === 'dismissed';
  // For reviewed entries with an existing note, start in read-only display mode.
  // For pending entries with an existing note, start in editing mode.
  // For entries without a note, start collapsed.
  const [isEditing, setIsEditing] = useState(
    existingNote ? !isReviewed : false,
  );
  const [noteText, setNoteText] = useState(existingNote ?? '');

  // Display-only view for reviewed entries with a saved note
  if (isReviewed && existingNote && !isEditing) {
    return (
      <div className="mt-3" aria-label="Saved reviewer note">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Reviewer note
        </p>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
          {existingNote}
        </p>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          aria-label="Edit reviewer note"
        >
          Edit note
        </button>
      </div>
    );
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label="Add a reviewer note"
      >
        Add note
      </button>
    );
  }

  return (
    <div className="mt-3">
      <label
        htmlFor={`reviewer-note-${entryId}`}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        Reviewer note
      </label>
      <textarea
        id={`reviewer-note-${entryId}`}
        value={noteText}
        onChange={(e) => {
          const value = e.target.value;
          if (value.length <= REVIEWER_NOTE_MAX_LENGTH) {
            setNoteText(value);
            onNoteChange(entryId, value);
          }
        }}
        maxLength={REVIEWER_NOTE_MAX_LENGTH}
        placeholder="Add a note explaining your review decision..."
        rows={2}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label="Reviewer note"
      />
      <p
        className="mt-1 text-right text-xs text-muted-foreground"
        aria-live="polite"
      >
        {noteText.length}/{REVIEWER_NOTE_MAX_LENGTH}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-entry action buttons
// ---------------------------------------------------------------------------

function DiffEntryActions({
  entry,
  onStatusChange,
  isLoading,
}: {
  entry: DiffReviewEntry;
  onStatusChange: (id: string, status: string) => void;
  isLoading: boolean;
}) {
  if (entry.diff_type === 'unchanged') return null;

  if (entry.status === 'pending_review') {
    return (
      <div className="flex gap-1">
        <button
          onClick={() => onStatusChange(entry.id, 'applied')}
          disabled={isLoading}
          className="rounded-md bg-quality-good-bg px-2 py-1 text-xs font-medium text-quality-good transition-colors hover:bg-quality-good-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          aria-label="Apply this change"
        >
          {isLoading ? 'Updating...' : 'Apply'}
        </button>
        <button
          onClick={() => onStatusChange(entry.id, 'dismissed')}
          disabled={isLoading}
          className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          aria-label="Dismiss this change"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onStatusChange(entry.id, 'pending_review')}
      disabled={isLoading}
      className="rounded-md bg-freshness-aging-bg px-2 py-1 text-xs font-medium text-freshness-aging transition-colors hover:bg-freshness-aging-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
      aria-label="Reset to pending review"
    >
      Reset
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bulk actions toolbar
// ---------------------------------------------------------------------------

function BulkActionToolbar({
  entries,
  onBulkStatusChange,
  isLoading,
  hasAffectedItems,
  onSendToReview,
  sendToReviewState,
}: {
  entries: DiffReviewEntry[];
  onBulkStatusChange: (ids: string[], status: string) => void;
  isLoading: boolean;
  hasAffectedItems: boolean;
  onSendToReview: () => void;
  sendToReviewState: 'idle' | 'loading' | 'success' | 'error';
}) {
  const actionable = entries.filter((e) => e.diff_type !== 'unchanged');
  const pendingIds = actionable
    .filter((e) => e.status === 'pending_review')
    .map((e) => e.id);
  const reviewedIds = actionable
    .filter((e) => e.status !== 'pending_review')
    .map((e) => e.id);

  if (actionable.length === 0) return null;

  const counts = { pending_review: 0, applied: 0, dismissed: 0 };
  actionable.forEach((e) => {
    if (e.status in counts) counts[e.status as keyof typeof counts]++;
  });

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
      role="toolbar"
      aria-label="Bulk review actions"
    >
      <button
        onClick={() => onBulkStatusChange(pendingIds, 'applied')}
        disabled={pendingIds.length === 0 || isLoading}
        className="rounded-md bg-quality-good-bg px-3 py-1.5 text-xs font-medium text-quality-good transition-colors hover:bg-quality-good-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
        aria-label="Accept all pending changes"
      >
        Accept All Pending
      </button>
      <button
        onClick={() => onBulkStatusChange(pendingIds, 'dismissed')}
        disabled={pendingIds.length === 0 || isLoading}
        className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
        aria-label="Dismiss all pending changes"
      >
        Dismiss All Pending
      </button>
      {reviewedIds.length > 0 && (
        <button
          onClick={() => onBulkStatusChange(reviewedIds, 'pending_review')}
          disabled={isLoading}
          className="rounded-md bg-freshness-aging-bg px-3 py-1.5 text-xs font-medium text-freshness-aging transition-colors hover:bg-freshness-aging-bg/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          aria-label="Reset all reviewed changes to pending"
        >
          Reset All
        </button>
      )}
      {hasAffectedItems && sendToReviewState !== 'success' && (
        <button
          onClick={onSendToReview}
          disabled={sendToReviewState === 'loading'}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
          aria-label="Send affected items to review"
        >
          {sendToReviewState === 'loading' ? 'Sending...' : 'Send affected items to review'}
        </button>
      )}
      <span
        className="ml-auto text-xs text-muted-foreground"
        aria-live="polite"
      >
        {counts.pending_review} pending, {counts.applied} applied,{' '}
        {counts.dismissed} dismissed
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-by-side content view for modified entries
// ---------------------------------------------------------------------------

function DiffContentBlock({
  label,
  oldText,
  newText,
  side,
}: {
  label: string;
  oldText: string;
  newText: string;
  side: 'old' | 'new';
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm whitespace-pre-wrap break-words">
        <DiffHighlightedText oldText={oldText} newText={newText} side={side} />
      </div>
    </div>
  );
}

function SideBySideContent({ entry }: { entry: DiffReviewEntry }) {
  const oldContent = entry.old_content ?? '';
  const newContent = entry.new_content ?? '';

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-md bg-destructive/5 p-1">
        <DiffContentBlock
          label="Old answer:"
          oldText={oldContent}
          newText={newContent}
          side="old"
        />
        {entry.old_question !== entry.new_question && entry.old_question && (
          <p className="mt-1 text-xs text-muted-foreground">
            Q: {entry.old_question}
          </p>
        )}
      </div>
      <div className="rounded-md bg-quality-good-bg/50 p-1">
        <DiffContentBlock
          label="New answer:"
          oldText={oldContent}
          newText={newContent}
          side="new"
        />
        {entry.old_question !== entry.new_question && entry.new_question && (
          <p className="mt-1 text-xs text-muted-foreground">
            Q: {entry.new_question}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Completion summary banner
// ---------------------------------------------------------------------------

function CompletionBanner({
  entries,
  sendToReviewState,
  sendToReviewResult,
  onSendToReview,
}: {
  entries: DiffReviewEntry[];
  sendToReviewState: 'idle' | 'loading' | 'success' | 'error';
  sendToReviewResult: {
    sent: number;
    already_pending: number;
    skipped_draft: number;
    review_url: string;
  } | null;
  onSendToReview: () => void;
}) {
  const actionable = entries.filter((e) => e.diff_type !== 'unchanged');
  if (actionable.length === 0) return null;

  const pendingCount = actionable.filter((e) => e.status === 'pending_review').length;
  if (pendingCount > 0) return null;

  const appliedCount = actionable.filter((e) => e.status === 'applied').length;
  const dismissedCount = actionable.filter((e) => e.status === 'dismissed').length;

  // Collect unique affected KB items from reviewed entries
  const affectedItems = new Map<string, string>();
  for (const entry of entries) {
    if (entry.affected_item && entry.diff_type !== 'unchanged') {
      affectedItems.set(entry.affected_item.id, entry.affected_item.title);
    }
  }

  return (
    <div
      className="rounded-lg border border-quality-good/30 bg-quality-good-bg p-4"
      role="status"
      aria-label="Review complete"
    >
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-quality-good">
        <CheckCircle2 className="size-4" aria-hidden="true" />
        All changes reviewed
      </h2>
      <p className="mt-1 text-sm text-foreground">
        {appliedCount} applied, {dismissedCount} dismissed
      </p>
      {affectedItems.size > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Affected KB items:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {Array.from(affectedItems.entries()).map(([id, title]) => (
              <li key={id} className="text-sm">
                <Link
                  href={`/item/${id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {title}
                </Link>
              </li>
            ))}
          </ul>

          {/* Send to Review Queue — separator + button */}
          <div className="mt-3 border-t border-quality-good/20 pt-3">
            {sendToReviewState === 'idle' && (
              <button
                onClick={onSendToReview}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                aria-label={`Send ${affectedItems.size} affected items to review queue`}
              >
                Send {affectedItems.size} affected item{affectedItems.size !== 1 ? 's' : ''} to Review Queue
              </button>
            )}

            {sendToReviewState === 'loading' && (
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50"
                aria-label="Sending items to review queue"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Sending...
              </button>
            )}

            {sendToReviewState === 'success' && sendToReviewResult && (
              <div className="text-sm text-foreground" aria-live="polite">
                <p>
                  {sendToReviewResult.sent} item{sendToReviewResult.sent !== 1 ? 's' : ''} sent to review queue.{' '}
                  <Link
                    href={sendToReviewResult.review_url}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    aria-label="View items in review queue"
                  >
                    View in Review Queue
                  </Link>
                </p>
                {(sendToReviewResult.already_pending > 0 || sendToReviewResult.skipped_draft > 0) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ({sendToReviewResult.already_pending > 0
                      ? `${sendToReviewResult.already_pending} already pending`
                      : ''}
                    {sendToReviewResult.already_pending > 0 && sendToReviewResult.skipped_draft > 0 ? ', ' : ''}
                    {sendToReviewResult.skipped_draft > 0
                      ? `${sendToReviewResult.skipped_draft} draft${sendToReviewResult.skipped_draft !== 1 ? 's' : ''} skipped`
                      : ''})
                  </p>
                )}
              </div>
            )}

            {sendToReviewState === 'error' && (
              <div className="text-sm" role="alert">
                <p className="text-destructive">Failed to send items to review queue.</p>
                <button
                  onClick={onSendToReview}
                  className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  aria-label="Retry sending items to review queue"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff entry card (updated with actions + side-by-side support + notes)
// ---------------------------------------------------------------------------

function DiffEntryCard({
  entry,
  onStatusChange,
  onNoteChange,
  isLoading,
  viewMode,
}: {
  entry: DiffReviewEntry;
  onStatusChange: (id: string, status: string) => void;
  onNoteChange: (id: string, note: string) => void;
  isLoading: boolean;
  viewMode: 'card' | 'side-by-side';
}) {
  // "Show changes" toggle for card view on modified entries
  const [showCardDiff, setShowCardDiff] = useState(false);

  const question =
    entry.diff_type === 'added'
      ? entry.new_question
      : entry.old_question;

  // Determine if inline diff should be shown in card view.
  // For large texts, only compute the diff when the user toggles it on.
  const isModified = entry.diff_type === 'modified';
  const oldContent = entry.old_content ?? '';
  const newContent = entry.new_content ?? '';
  const isLargeText = isModified && exceedsLazyThreshold(oldContent, newContent);
  // In card mode: show diff only when toggled on (lazy for large texts, eager for small)
  const showDiffInCard = isModified && viewMode === 'card' && showCardDiff;

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-label={`${entry.diff_type} entry: ${question ?? 'No question'}`}
    >
      {/* Header row: badge + similarity + actions + status */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DiffTypeBadge diffType={entry.diff_type} />

        {isModified &&
          entry.similarity_score !== undefined && (
            <span
              className="text-xs text-muted-foreground"
              aria-label={`Similarity: ${Math.round(entry.similarity_score * 100)}%`}
            >
              (similarity: {Math.round(entry.similarity_score * 100)}%)
            </span>
          )}

        <span className="flex-1" />

        <DiffEntryActions
          entry={entry}
          onStatusChange={onStatusChange}
          isLoading={isLoading}
        />

        <StatusBadge status={entry.status} />
      </div>

      {/* Question */}
      {question && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Q: {question}
        </h3>
      )}

      {/* Question changed indicator for modified entries */}
      {isModified &&
        entry.old_question &&
        entry.new_question &&
        entry.old_question !== entry.new_question && (
          <p className="mb-3 text-xs text-muted-foreground">
            Question changed to: <em>{entry.new_question}</em>
          </p>
        )}

      {/* Content blocks */}
      <div className="space-y-3">
        {isModified && viewMode === 'side-by-side' ? (
          <SideBySideContent entry={entry} />
        ) : (
          <>
            {isModified && (
              <>
                {/* "Show changes" / "Hide changes" toggle for card view */}
                {viewMode === 'card' && (
                  <button
                    type="button"
                    onClick={() => setShowCardDiff((prev) => !prev)}
                    className="mb-2 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    aria-pressed={showCardDiff}
                    aria-label={showCardDiff ? 'Hide inline changes' : 'Show inline changes'}
                  >
                    {showCardDiff ? 'Hide changes' : 'Show changes'}
                    {isLargeText && !showCardDiff && (
                      <span className="ml-1 text-muted-foreground/60">(large text)</span>
                    )}
                  </button>
                )}

                {showDiffInCard ? (
                  <>
                    {oldContent && (
                      <DiffContentBlock
                        label="Old answer:"
                        oldText={oldContent}
                        newText={newContent}
                        side="old"
                      />
                    )}
                    {newContent && (
                      <DiffContentBlock
                        label="New answer:"
                        oldText={oldContent}
                        newText={newContent}
                        side="new"
                      />
                    )}
                  </>
                ) : (
                  <>
                    {oldContent && (
                      <ContentBlock
                        label="Old answer:"
                        content={oldContent}
                      />
                    )}
                    {newContent && (
                      <ContentBlock
                        label="New answer:"
                        content={newContent}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {entry.diff_type === 'added' && entry.new_content && (
              <ContentBlock label="Answer:" content={entry.new_content} />
            )}

            {entry.diff_type === 'removed' && entry.old_content && (
              <ContentBlock label="Answer:" content={entry.old_content} />
            )}

            {entry.diff_type === 'unchanged' && entry.old_content && (
              <ContentBlock label="Answer:" content={entry.old_content} />
            )}
          </>
        )}
      </div>

      {/* Affected KB item */}
      {entry.affected_item && (
        <div className="mt-3 flex items-center gap-1 text-sm">
          <span className="text-muted-foreground">Affected KB item:</span>
          <Link
            href={`/item/${entry.affected_item.id}`}
            className="font-medium text-primary underline-offset-4 hover:underline"
            aria-label={`View affected item: ${entry.affected_item.title}`}
          >
            {entry.affected_item.title}
          </Link>
        </div>
      )}

      {/* Reviewer note */}
      {entry.diff_type !== 'unchanged' && (
        <ReviewerNoteInput
          entryId={entry.id}
          existingNote={entry.reviewer_note}
          entryStatus={entry.status}
          onNoteChange={onNoteChange}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full-text diff entry card — no Q: heading, prose-appropriate labels
// ---------------------------------------------------------------------------

function FullTextDiffEntryCard({
  entry,
  onStatusChange,
  onNoteChange,
  isLoading,
  viewMode,
}: {
  entry: DiffReviewEntry;
  onStatusChange: (id: string, status: string) => void;
  onNoteChange: (id: string, note: string) => void;
  isLoading: boolean;
  viewMode: 'card' | 'side-by-side';
}) {
  const [showCardDiff, setShowCardDiff] = useState(false);

  const isModified = entry.diff_type === 'modified';
  const oldContent = entry.old_content ?? '';
  const newContent = entry.new_content ?? '';
  const showDiffInCard = isModified && viewMode === 'card' && showCardDiff;

  // Labels appropriate for full-text mode
  const oldLabel = isModified ? 'Old version:' : 'Removed:';
  const newLabel = isModified ? 'New version:' : 'Added:';

  // Background tint for added/removed entries
  const cardBg =
    entry.diff_type === 'added'
      ? 'bg-quality-good-bg/30'
      : entry.diff_type === 'removed'
        ? 'bg-destructive/5'
        : '';

  const ariaLabel = `${entry.diff_type} text block`;

  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-4 shadow-sm', cardBg)}
      aria-label={ariaLabel}
    >
      {/* Header row: badge + actions + status */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DiffTypeBadge diffType={entry.diff_type} />

        <span className="flex-1" />

        <DiffEntryActions
          entry={entry}
          onStatusChange={onStatusChange}
          isLoading={isLoading}
        />

        <StatusBadge status={entry.status} />
      </div>

      {/* Section header context label */}
      {entry.section_header && (
        <p
          className="mb-2 text-xs font-medium text-muted-foreground"
          aria-label={`Section: ${entry.section_header}`}
        >
          Section: {entry.section_header}
        </p>
      )}

      {/* Content blocks */}
      <div className="space-y-3">
        {isModified && viewMode === 'side-by-side' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md bg-destructive/5 p-1">
              <DiffContentBlock
                label={oldLabel}
                oldText={oldContent}
                newText={newContent}
                side="old"
              />
            </div>
            <div className="rounded-md bg-quality-good-bg/50 p-1">
              <DiffContentBlock
                label={newLabel}
                oldText={oldContent}
                newText={newContent}
                side="new"
              />
            </div>
          </div>
        ) : (
          <>
            {isModified && (
              <>
                {viewMode === 'card' && (
                  <button
                    type="button"
                    onClick={() => setShowCardDiff((prev) => !prev)}
                    className="mb-2 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    aria-pressed={showCardDiff}
                    aria-label={showCardDiff ? 'Hide inline changes' : 'Show inline changes'}
                  >
                    {showCardDiff ? 'Hide changes' : 'Show changes'}
                  </button>
                )}

                {showDiffInCard ? (
                  <>
                    {oldContent && (
                      <DiffContentBlock
                        label={oldLabel}
                        oldText={oldContent}
                        newText={newContent}
                        side="old"
                      />
                    )}
                    {newContent && (
                      <DiffContentBlock
                        label={newLabel}
                        oldText={oldContent}
                        newText={newContent}
                        side="new"
                      />
                    )}
                  </>
                ) : (
                  <>
                    {oldContent && (
                      <ContentBlock label={oldLabel} content={oldContent} />
                    )}
                    {newContent && (
                      <ContentBlock label={newLabel} content={newContent} />
                    )}
                  </>
                )}
              </>
            )}

            {entry.diff_type === 'added' && entry.new_content && (
              <ContentBlock label={newLabel} content={entry.new_content} />
            )}

            {entry.diff_type === 'removed' && entry.old_content && (
              <ContentBlock label={oldLabel} content={entry.old_content} />
            )}

            {entry.diff_type === 'unchanged' && entry.old_content && (
              <ContentBlock label="Content:" content={entry.old_content} />
            )}
          </>
        )}
      </div>

      {/* Reviewer note */}
      {entry.diff_type !== 'unchanged' && (
        <ReviewerNoteInput
          entryId={entry.id}
          existingNote={entry.reviewer_note}
          entryStatus={entry.status}
          onNoteChange={onNoteChange}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SourceDocumentDiffReview({
  documentId,
  oldDocument,
  newDocument,
  summary,
  entries,
}: SourceDocumentDiffReviewProps) {
  const [activeFilter, setActiveFilter] = useState<DiffFilter>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'side-by-side'>('card');

  // All mutation, optimistic update, and review state is managed by the hook
  const {
    entries: localEntries,
    localSummary,
    loadingIds,
    updateError,
    dismissError: clearUpdateError,
    handleNoteChange,
    handleStatusChange: handleSingleStatusChange,
    handleBulkStatusChange,
    handleSendToReview,
    sendToReviewState,
    sendToReviewResult,
    hasAffectedItems,
  } = useDiffReview(documentId, entries);

  // Detect diff mode from entries: explicit diff_mode field, or infer from content
  const diffMode: 'qa' | 'full_text' =
    entries.length > 0 && entries[0]?.diff_mode
      ? entries[0].diff_mode
      : entries.every((e) => !e.old_question && !e.new_question)
        ? 'full_text'
        : 'qa';

  // Filter entries based on active filter and unchanged toggle
  const filteredEntries = localEntries.filter((entry) => {
    // Hide unchanged unless toggled on
    if (entry.diff_type === 'unchanged' && !showUnchanged) return false;

    if (activeFilter === 'all') return true;
    return entry.diff_type === activeFilter;
  });

  const totalVisible =
    summary.added + summary.removed + summary.modified;

  const isAnyLoading = loadingIds.size > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Breadcrumb navigation */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-sm text-muted-foreground">
          <li>
            <Link
              href="/documents"
              className="hover:text-foreground transition-colors"
            >
              Source Documents
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <Link
              href={`/documents/${newDocument.id}`}
              className="hover:text-foreground transition-colors"
            >
              {newDocument.filename}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li className="text-foreground" aria-current="page">
            Diff Review
          </li>
        </ol>
      </nav>

      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-foreground">
          Document Diff Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {oldDocument.filename} (v{oldDocument.version},{' '}
          {formatDateUK(oldDocument.uploaded_at)}) &rarr;{' '}
          {newDocument.filename} (v{newDocument.version},{' '}
          {formatDateUK(newDocument.uploaded_at)})
        </p>
      </header>

      {/* Completion banner — shown when all actionable entries have been reviewed */}
      <CompletionBanner
        entries={localEntries}
        sendToReviewState={sendToReviewState}
        sendToReviewResult={sendToReviewResult}
        onSendToReview={handleSendToReview}
      />

      {/* Summary bar */}
      <div
        className="flex flex-wrap gap-4 rounded-lg border border-border bg-card p-4"
        aria-label="Diff summary"
      >
        <SummaryItem label="Modified" count={summary.modified} type="modified" />
        <SummaryItem label="Added" count={summary.added} type="added" />
        <SummaryItem label="Removed" count={summary.removed} type="removed" />
        <SummaryItem
          label="Unchanged"
          count={summary.unchanged}
          type="unchanged"
        />
        <span className="mx-2 text-border">|</span>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {localSummary.pending_review} pending, {localSummary.applied} applied,{' '}
          {localSummary.dismissed} dismissed
        </span>
      </div>

      {/* Filter tabs + view mode toggle */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter diff entries">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            id={`diff-tab-${option.value}`}
            role="tab"
            aria-selected={activeFilter === option.value}
            aria-controls="diff-entries-panel"
            aria-label={`Show ${option.label.toLowerCase()} entries`}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              activeFilter === option.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
            onClick={() => setActiveFilter(option.value)}
          >
            {option.label}
          </button>
        ))}

        {/* Unchanged toggle */}
        <label className="ml-4 flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
            className="rounded border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          />
          Show unchanged ({summary.unchanged})
        </label>

        {/* Side-by-side toggle — only when modified entries exist */}
        {localEntries.some((e) => e.diff_type === 'modified') && (
          <div
            className="ml-auto flex gap-1 rounded-lg bg-muted p-1"
            role="radiogroup"
            aria-label="View mode"
          >
            <button
              role="radio"
              aria-checked={viewMode === 'card'}
              aria-label="Card View"
              onClick={() => setViewMode('card')}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                viewMode === 'card'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Card View
            </button>
            <button
              role="radio"
              aria-checked={viewMode === 'side-by-side'}
              aria-label="Side-by-Side"
              onClick={() => setViewMode('side-by-side')}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                viewMode === 'side-by-side'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Side-by-Side
            </button>
          </div>
        )}
      </div>

      {/* Progress indicator */}
      {(() => {
        const actionable = localEntries.filter((e) => e.diff_type !== 'unchanged');
        const reviewed = actionable.filter((e) => e.status !== 'pending_review').length;
        const total = actionable.length;
        if (total === 0) return null;
        return (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Reviewed {reviewed} of {total}
          </p>
        );
      })()}

      {/* Bulk actions toolbar */}
      <BulkActionToolbar
        entries={localEntries}
        onBulkStatusChange={handleBulkStatusChange}
        isLoading={isAnyLoading}
        hasAffectedItems={hasAffectedItems}
        onSendToReview={handleSendToReview}
        sendToReviewState={sendToReviewState}
      />

      {/* Error message */}
      {updateError && (
        <div
          className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">{updateError}</p>
          <button
            onClick={clearUpdateError}
            className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Entries list */}
      <div
        id="diff-entries-panel"
        className="space-y-4"
        role="tabpanel"
        aria-labelledby={`diff-tab-${activeFilter}`}
        aria-live="polite"
      >
        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-muted-foreground">
              {totalVisible === 0 && localEntries.length === 0
                ? 'No diff entries found.'
                : 'No entries match the current filter.'}
            </p>
          </div>
        ) : (
          <div role="feed" aria-label="Diff review entries">
            {filteredEntries.map((entry, index) => (
              <div
                key={entry.id}
                className={index > 0 ? 'mt-4' : undefined}
                role="article"
                aria-setsize={filteredEntries.length}
                aria-posinset={index + 1}
              >
                {diffMode === 'full_text' ? (
                  <FullTextDiffEntryCard
                    entry={entry}
                    onStatusChange={handleSingleStatusChange}
                    onNoteChange={handleNoteChange}
                    isLoading={loadingIds.has(entry.id)}
                    viewMode={viewMode}
                  />
                ) : (
                  <DiffEntryCard
                    entry={entry}
                    onStatusChange={handleSingleStatusChange}
                    onNoteChange={handleNoteChange}
                    isLoading={loadingIds.has(entry.id)}
                    viewMode={viewMode}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary item helper
// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  count,
  type,
}: {
  label: string;
  count: number;
  type: DiffReviewEntry['diff_type'];
}) {
  const { text, bg } = getDiffTypeBadgeClasses(type);

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
          text,
          bg,
        )}
        aria-hidden="true"
      >
        {count}
      </span>
      <span className="text-sm text-foreground">{label}</span>
    </div>
  );
}
