'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffReviewEntry {
  id: string;
  diff_type: 'added' | 'removed' | 'modified' | 'unchanged';
  old_question?: string;
  new_question?: string;
  old_content?: string;
  new_content?: string;
  similarity_score?: number;
  affected_item?: { id: string; title: string };
  status: string;
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
}: {
  entries: DiffReviewEntry[];
  onBulkStatusChange: (ids: string[], status: string) => void;
  isLoading: boolean;
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

function SideBySideContent({ entry }: { entry: DiffReviewEntry }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-md bg-destructive/5 p-1">
        <ContentBlock label="Old answer:" content={entry.old_content ?? ''} />
        {entry.old_question !== entry.new_question && entry.old_question && (
          <p className="mt-1 text-xs text-muted-foreground">
            Q: {entry.old_question}
          </p>
        )}
      </div>
      <div className="rounded-md bg-quality-good-bg/50 p-1">
        <ContentBlock label="New answer:" content={entry.new_content ?? ''} />
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
// Diff entry card (updated with actions + side-by-side support)
// ---------------------------------------------------------------------------

function DiffEntryCard({
  entry,
  onStatusChange,
  isLoading,
  viewMode,
}: {
  entry: DiffReviewEntry;
  onStatusChange: (id: string, status: string) => void;
  isLoading: boolean;
  viewMode: 'card' | 'side-by-side';
}) {
  const question =
    entry.diff_type === 'added'
      ? entry.new_question
      : entry.old_question;

  return (
    <article
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-label={`${entry.diff_type} entry: ${question ?? 'No question'}`}
    >
      {/* Header row: badge + similarity + actions + status */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DiffTypeBadge diffType={entry.diff_type} />

        {entry.diff_type === 'modified' &&
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
      {entry.diff_type === 'modified' &&
        entry.old_question &&
        entry.new_question &&
        entry.old_question !== entry.new_question && (
          <p className="mb-3 text-xs text-muted-foreground">
            Question changed to: <em>{entry.new_question}</em>
          </p>
        )}

      {/* Content blocks */}
      <div className="space-y-3">
        {entry.diff_type === 'modified' && viewMode === 'side-by-side' ? (
          <SideBySideContent entry={entry} />
        ) : (
          <>
            {entry.diff_type === 'modified' && (
              <>
                {entry.old_content && (
                  <ContentBlock
                    label="Old answer:"
                    content={entry.old_content}
                  />
                )}
                {entry.new_content && (
                  <ContentBlock
                    label="New answer:"
                    content={entry.new_content}
                  />
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
    </article>
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

  // Local state for optimistic updates
  const [localEntries, setLocalEntries] = useState(entries);
  const [localSummary, setLocalSummary] = useState<{
    pending_review: number;
    applied: number;
    dismissed: number;
  }>(() => {
    const counts = { pending_review: 0, applied: 0, dismissed: 0 };
    for (const e of entries) {
      const s = e.status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    return counts;
  });
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

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

  // Status update handler with optimistic update and rollback
  async function handleStatusChange(entryIds: string[], newStatus: string) {
    const previousEntries = [...localEntries];
    const previousSummary = { ...localSummary };

    // Optimistic update
    setLocalEntries((prev) =>
      prev.map((e) =>
        entryIds.includes(e.id) ? { ...e, status: newStatus } : e,
      ),
    );
    setLoadingIds((prev) => new Set([...prev, ...entryIds]));

    // Recompute summary optimistically
    const newSummaryCounts = { pending_review: 0, applied: 0, dismissed: 0 };
    localEntries.forEach((e) => {
      const s = entryIds.includes(e.id) ? newStatus : e.status;
      if (s in newSummaryCounts)
        newSummaryCounts[s as keyof typeof newSummaryCounts]++;
    });
    setLocalSummary(newSummaryCounts);

    setUpdateError(null);

    try {
      const res = await fetch(`/api/source-documents/${documentId}/diff`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: entryIds.map((id) => ({ id, status: newStatus })),
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      // Use server summary
      setLocalSummary(data.summary);
    } catch {
      // Rollback and show error
      setLocalEntries(previousEntries);
      setLocalSummary(previousSummary);
      setUpdateError('Failed to update review status. Please try again.');
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        entryIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  function handleSingleStatusChange(id: string, status: string) {
    handleStatusChange([id], status);
  }

  function handleBulkStatusChange(ids: string[], status: string) {
    if (ids.length === 0) return;
    handleStatusChange(ids, status);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Back link */}
      <button
        onClick={() => window.history.back()}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label="Go back"
      >
        &larr; Back
      </button>

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

      {/* Bulk actions toolbar */}
      <BulkActionToolbar
        entries={localEntries}
        onBulkStatusChange={handleBulkStatusChange}
        isLoading={isAnyLoading}
      />

      {/* Error message */}
      {updateError && (
        <div
          className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-3"
          role="alert"
        >
          <p className="text-sm text-destructive">{updateError}</p>
          <button
            onClick={() => setUpdateError(null)}
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
          filteredEntries.map((entry) => (
            <DiffEntryCard
              key={entry.id}
              entry={entry}
              onStatusChange={handleSingleStatusChange}
              isLoading={loadingIds.has(entry.id)}
              viewMode={viewMode}
            />
          ))
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
