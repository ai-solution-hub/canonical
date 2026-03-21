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

function DiffEntryCard({ entry }: { entry: DiffReviewEntry }) {
  const question =
    entry.diff_type === 'added'
      ? entry.new_question
      : entry.old_question;

  return (
    <article
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
      aria-label={`${entry.diff_type} entry: ${question ?? 'No question'}`}
    >
      {/* Header row: badge + similarity + status */}
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
        {entry.diff_type === 'modified' && (
          <>
            {entry.old_content && (
              <ContentBlock label="Old answer:" content={entry.old_content} />
            )}
            {entry.new_content && (
              <ContentBlock label="New answer:" content={entry.new_content} />
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
  oldDocument,
  newDocument,
  summary,
  entries,
}: SourceDocumentDiffReviewProps) {
  const [activeFilter, setActiveFilter] = useState<DiffFilter>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);

  // Filter entries based on active filter and unchanged toggle
  const filteredEntries = entries.filter((entry) => {
    // Hide unchanged unless toggled on
    if (entry.diff_type === 'unchanged' && !showUnchanged) return false;

    if (activeFilter === 'all') return true;
    return entry.diff_type === activeFilter;
  });

  const totalVisible =
    summary.added + summary.removed + summary.modified;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Back link */}
      <Link
        href="/browse"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        aria-label="Back to browse"
      >
        &larr; Back to Browse
      </Link>

      {/* Page header */}
      <header>
        <h1 className="text-2xl font-bold text-foreground">
          Document Diff Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {oldDocument.filename} (v{oldDocument.version}, {formatDateUK(oldDocument.uploaded_at)}) &rarr;{' '}
          {newDocument.filename} (v{newDocument.version}, {formatDateUK(newDocument.uploaded_at)})
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
      </div>

      {/* Filter tabs */}
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
      </div>

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
              {totalVisible === 0 && entries.length === 0
                ? 'No diff entries found.'
                : 'No entries match the current filter.'}
            </p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <DiffEntryCard key={entry.id} entry={entry} />
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
