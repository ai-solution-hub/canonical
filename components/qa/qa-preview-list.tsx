'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Pencil,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import type { QACreateInput, DetectionSource, DetectionConfidence } from '@/lib/quality/qa-detection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Dedup check status for a single Q&A pair. */
export type DedupStatus = 'pending' | 'checking' | 'clear' | 'duplicate' | 'error';

/** A match returned from the dedup check endpoint. */
export interface DedupCheckMatch {
  id: string;
  title: string;
  similarity: number;
}

/** Result from the dedup check endpoint for one pair. */
export interface DedupCheckResult {
  isDuplicate: boolean;
  matches: DedupCheckMatch[];
  /** True when the dedup check itself failed (API error or network error). */
  error?: boolean;
}

/** Props for the QAPreviewList component. */
export interface QAPreviewListProps {
  /** Q&A pairs detected from the uploaded document. */
  pairs: QACreateInput[];
  /** Callback when pairs are confirmed for creation. */
  onConfirm: (pairs: QACreateInput[]) => void;
  /** Callback when user chooses to skip Q&A detection. */
  onSkip: () => void;
  /** Optional: function to check a single pair for duplicates. */
  onDedupCheck?: (text: string) => Promise<DedupCheckResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum concurrent dedup check requests. */
const MAX_CONCURRENT_DEDUP = 3;

/** Answer text truncation length for preview display. */
const ANSWER_PREVIEW_LENGTH = 200;

// ---------------------------------------------------------------------------
// Helper: source badge colours (semantic tokens only)
// ---------------------------------------------------------------------------

function sourceBadgeVariant(source: DetectionSource): 'default' | 'secondary' | 'outline' {
  switch (source) {
    case 'table':
      return 'default';
    case 'list':
    case 'heading':
      return 'secondary';
    case 'text':
      return 'outline';
  }
}

function confidenceBadgeVariant(
  confidence: DetectionConfidence,
): 'default' | 'secondary' | 'outline' {
  switch (confidence) {
    case 'high':
      return 'default';
    case 'medium':
      return 'secondary';
    case 'low':
      return 'outline';
  }
}

// ---------------------------------------------------------------------------
// Dedup status indicator
// ---------------------------------------------------------------------------

function DedupStatusIndicator({
  status,
  matches,
}: {
  status: DedupStatus;
  matches: DedupCheckMatch[];
}) {
  switch (status) {
    case 'pending':
      return null;
    case 'checking':
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="dedup-checking"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Checking for duplicates...
        </span>
      );
    case 'clear':
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-quality-good"
          data-testid="dedup-clear"
        >
          <CheckCircle className="size-3" aria-hidden="true" />
          No duplicates found
        </span>
      );
    case 'error':
      return (
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
          data-testid="dedup-error"
        >
          <AlertTriangle className="size-3" aria-hidden="true" />
          Duplicate check unavailable
        </span>
      );
    case 'duplicate':
      return (
        <div data-testid="dedup-duplicate">
          <span className="inline-flex items-center gap-1 text-xs text-status-warning">
            <AlertTriangle className="size-3" aria-hidden="true" />
            Potential {matches.length === 1 ? 'duplicate' : 'duplicates'} found
          </span>
          {matches.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-4">
              {matches.slice(0, 3).map((match) => (
                <li key={match.id} className="text-xs text-muted-foreground">
                  {match.title} ({Math.round(match.similarity * 100)}% similar)
                </li>
              ))}
            </ul>
          )}
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Single Q&A pair card
// ---------------------------------------------------------------------------

function QAPairCard({
  pair,
  index,
  selected,
  dedupStatus,
  dedupMatches,
  onToggle,
  onRemove,
  onEdit,
}: {
  pair: QACreateInput;
  index: number;
  selected: boolean;
  dedupStatus: DedupStatus;
  dedupMatches: DedupCheckMatch[];
  onToggle: () => void;
  onRemove: () => void;
  onEdit: (field: 'question' | 'answer', value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Extract question and answer from content ("Q: ...\n\nA: ...")
  const questionText = pair.title;
  const answerText = pair.content.replace(/^Q:[\s\S]*?\n\nA:\s*/, '');
  const needsTruncation = answerText.length > ANSWER_PREVIEW_LENGTH;

  return (
    <article
      role="article"
      aria-label={`Q&A pair ${index + 1}: ${questionText.slice(0, 60)}`}
      className={`rounded-lg border p-4 space-y-3 transition-colors ${
        selected
          ? 'border-border bg-card'
          : 'border-border/50 bg-muted/30 opacity-60'
      }`}
      data-testid={`qa-pair-${index}`}
    >
      {/* Header row: checkbox + question + badges + remove */}
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Include pair ${index + 1}`}
          data-testid={`qa-checkbox-${index}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          {editing ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Question
              </label>
              <Textarea
                value={questionText}
                onChange={(e) => onEdit('question', e.target.value)}
                className="min-h-[60px] text-sm"
                aria-label={`Edit question for pair ${index + 1}`}
                data-testid={`qa-question-input-${index}`}
              />
              <label className="text-xs font-medium text-muted-foreground">
                Answer
              </label>
              <Textarea
                value={answerText}
                onChange={(e) => onEdit('answer', e.target.value)}
                className="min-h-[80px] text-sm"
                aria-label={`Edit answer for pair ${index + 1}`}
                data-testid={`qa-answer-input-${index}`}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(false)}
                data-testid={`qa-done-editing-${index}`}
              >
                Done editing
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium text-foreground" data-testid={`qa-question-${index}`}>
                {questionText}
              </p>
              <div className="text-sm text-muted-foreground" data-testid={`qa-answer-${index}`}>
                {expanded || !needsTruncation
                  ? answerText
                  : answerText.slice(0, ANSWER_PREVIEW_LENGTH) + '...'}
                {needsTruncation && (
                  <button
                    type="button"
                    onClick={() => setExpanded(!expanded)}
                    className="ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
                    aria-label={expanded ? 'Show less of answer' : 'Show more of answer'}
                  >
                    {expanded ? (
                      <>
                        Show less <ChevronUp className="size-3" aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        Show more <ChevronDown className="size-3" aria-hidden="true" />
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}

          {/* Metadata badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={sourceBadgeVariant(pair.source)} data-testid={`qa-source-${index}`}>
              {pair.source}
            </Badge>
            <Badge
              variant={confidenceBadgeVariant(pair.confidence)}
              data-testid={`qa-confidence-${index}`}
            >
              {pair.confidence}
            </Badge>
            {pair.sectionName && (
              <Badge variant="outline" data-testid={`qa-section-${index}`}>
                {pair.sectionName}
              </Badge>
            )}
          </div>

          {/* Dedup status */}
          <DedupStatusIndicator status={dedupStatus} matches={dedupMatches} />
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              aria-label={`Edit pair ${index + 1}`}
              data-testid={`qa-edit-${index}`}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="size-7 p-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove pair ${index + 1}`}
            data-testid={`qa-remove-${index}`}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main QAPreviewList component
// ---------------------------------------------------------------------------

/**
 * Preview list for detected Q&A pairs before batch creation.
 *
 * Shows each pair as an editable card with selection checkboxes,
 * source/confidence badges, and per-pair dedup status indicators.
 * Dedup checking runs in the background with throttled concurrency.
 *
 * WCAG 2.1 AA compliant:
 * - Keyboard navigable (tab through pairs, space to toggle, enter to edit)
 * - Proper aria-labels on interactive elements
 * - Focus indicators on all interactive elements
 * - No colour-only meaning (text labels accompany all badges)
 */
export function QAPreviewList({ pairs: initialPairs, onConfirm, onSkip, onDedupCheck }: QAPreviewListProps) {
  // Mutable pair data — inline editing modifies these
  const [pairs, setPairs] = useState<QACreateInput[]>(initialPairs);

  // Track which pairs are selected (by index)
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(initialPairs.map((_, i) => i)),
  );

  // Track which pairs have been removed
  const [removed, setRemoved] = useState<Set<number>>(new Set());

  // Dedup state per pair
  const [dedupStatuses, setDedupStatuses] = useState<Map<number, DedupStatus>>(
    () => new Map(initialPairs.map((_, i) => [i, 'pending' as DedupStatus])),
  );
  const [dedupMatches, setDedupMatches] = useState<Map<number, DedupCheckMatch[]>>(
    () => new Map(),
  );

  // Ref to track if dedup checking has been initiated
  const dedupStartedRef = useRef(false);

  // Track which pairs have been edited and need dedup re-check
  const editedIndicesRef = useRef<Set<number>>(new Set());

  // ---------------------------------------------------------------------------
  // Dedup checking — throttled to MAX_CONCURRENT_DEDUP concurrent requests
  // ---------------------------------------------------------------------------

  const runDedupChecks = useCallback(async () => {
    if (!onDedupCheck) return;

    // Determine which indices to check:
    // - On first run, check all non-removed indices
    // - On subsequent runs, only check indices that were edited
    const indicesToCheck = dedupStartedRef.current
      ? Array.from(editedIndicesRef.current).filter((i) => !removed.has(i))
      : pairs.map((_, i) => i).filter((i) => !removed.has(i));

    if (indicesToCheck.length === 0) return;

    dedupStartedRef.current = true;
    editedIndicesRef.current.clear();
    let active = 0;
    let nextIdx = 0;

    const checkNext = async (): Promise<void> => {
      while (nextIdx < indicesToCheck.length && active < MAX_CONCURRENT_DEDUP) {
        const idx = indicesToCheck[nextIdx++];
        active++;

        // Mark as checking
        setDedupStatuses((prev) => new Map(prev).set(idx, 'checking'));

        try {
          const result = await onDedupCheck(pairs[idx].content);
          if (result.error) {
            setDedupStatuses((prev) => new Map(prev).set(idx, 'error'));
          } else {
            setDedupStatuses((prev) =>
              new Map(prev).set(idx, result.isDuplicate ? 'duplicate' : 'clear'),
            );
            if (result.matches.length > 0) {
              setDedupMatches((prev) => new Map(prev).set(idx, result.matches));
            }
          }
        } catch {
          // On error, mark as error (dedup is advisory, not blocking)
          setDedupStatuses((prev) => new Map(prev).set(idx, 'error'));
        }

        active--;
        await checkNext();
      }
    };

    await checkNext();
  }, [onDedupCheck, pairs, removed]);

  useEffect(() => {
    runDedupChecks();
  }, [runDedupChecks]);

  // ---------------------------------------------------------------------------
  // Selection handlers
  // ---------------------------------------------------------------------------

  const visibleIndices = pairs
    .map((_, i) => i)
    .filter((i) => !removed.has(i));

  const selectedCount = visibleIndices.filter((i) => selected.has(i)).length;
  const totalVisible = visibleIndices.length;
  const allSelected = selectedCount === totalVisible && totalVisible > 0;

  const handleToggle = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(visibleIndices));
  }, [visibleIndices]);

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleRemove = useCallback((index: number) => {
    setRemoved((prev) => new Set(prev).add(index));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  }, []);

  const handleEdit = useCallback(
    (index: number, field: 'question' | 'answer', value: string) => {
      setPairs((prev) => {
        const updated = [...prev];
        const pair = { ...updated[index] };

        if (field === 'question') {
          // Update title (truncated) and content
          pair.title = value.length > 120 ? value.slice(0, 117) + '...' : value;
          // Rebuild content with new question
          const existingAnswer = pair.content.replace(/^Q:[\s\S]*?\n\nA:\s*/, '');
          pair.content = `Q: ${value}\n\nA: ${existingAnswer}`;
        } else {
          // Update answer in content
          const existingQuestion = pair.content.match(/^Q:\s*([\s\S]*?)(?=\n\nA:)/)?.[1] ?? pair.title;
          pair.content = `Q: ${existingQuestion}\n\nA: ${value}`;
        }

        updated[index] = pair;
        return updated;
      });

      // Mark this pair for dedup re-check
      editedIndicesRef.current.add(index);
      // Reset the dedup status for this pair to pending
      setDedupStatuses((prev) => new Map(prev).set(index, 'pending'));
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    const confirmedPairs = visibleIndices
      .filter((i) => selected.has(i))
      .map((i) => pairs[i]);
    onConfirm(confirmedPairs);
  }, [visibleIndices, selected, pairs, onConfirm]);

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (totalVisible === 0) {
    return (
      <div
        role="region"
        aria-label="No Q&A pairs"
        className="py-8 text-center"
        data-testid="qa-preview-empty"
      >
        <p className="text-sm text-muted-foreground">
          No Q&A pairs to preview.
        </p>
        <Button variant="outline" size="sm" onClick={onSkip} className="mt-4">
          Continue
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      role="region"
      aria-label="Q&A pair preview"
      className="space-y-4"
      data-testid="qa-preview-list"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Detected Q&A pairs
          </h3>
          <Badge variant="secondary" data-testid="qa-count-badge">
            {selectedCount} of {totalVisible} selected
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={allSelected ? handleDeselectAll : handleSelectAll}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
            data-testid="qa-toggle-all"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      </div>

      {/* Pair cards */}
      <div className="space-y-3 max-h-[60vh] overflow-y-auto" role="list">
        {pairs.map((pair, index) => {
          if (removed.has(index)) return null;
          return (
            <div role="listitem" key={index}>
              <QAPairCard
                pair={pair}
                index={index}
                selected={selected.has(index)}
                dedupStatus={dedupStatuses.get(index) ?? 'pending'}
                dedupMatches={dedupMatches.get(index) ?? []}
                onToggle={() => handleToggle(index)}
                onRemove={() => handleRemove(index)}
                onEdit={(field, value) => handleEdit(index, field, value)}
              />
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onSkip}
          data-testid="qa-skip-button"
        >
          Skip
        </Button>
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={selectedCount === 0}
          data-testid="qa-confirm-button"
        >
          Create {selectedCount} {selectedCount === 1 ? 'item' : 'items'}
        </Button>
      </div>
    </div>
  );
}
