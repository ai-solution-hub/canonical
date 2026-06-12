'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useItemProvenance } from '@/hooks/provenance/use-item-provenance';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import PerItemField from '@/components/provenance/per-item-field';
import { formatDateUK } from '@/lib/format';

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Confidence formatting
// ---------------------------------------------------------------------------

function formatConfidence(value: number | null): string | null {
  if (value === null) return null;
  return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Review-schedule formatting (T4-AC1/AC2/AC3)
// ---------------------------------------------------------------------------

/** T4-AC1 — "{DD/MM/YYYY}" or "Not scheduled". */
function formatNextReviewDate(nextReviewDate: string | null): string {
  return formatDateUK(nextReviewDate) || 'Not scheduled';
}

/**
 * T4-AC2 — Render the review cadence in human-readable form.
 *
 * - Both fields null → "No cadence set"
 * - `review_cadence_days IS NULL` but `next_review_date` set → "One-off review"
 * - Otherwise → "Every {N} days ({M} months)" where M = round(N/30)
 *
 * Pluralisation: "1 day"/"N days", "1 month"/"M months".
 */
function formatReviewCadence(
  reviewCadenceDays: number | null,
  nextReviewDate: string | null,
): string {
  if (reviewCadenceDays === null) {
    return nextReviewDate ? 'One-off review' : 'No cadence set';
  }

  const days = reviewCadenceDays;
  const months = Math.round(days / 30);
  const dayWord = days === 1 ? 'day' : 'days';
  const monthWord = months === 1 ? 'month' : 'months';
  return `Every ${days} ${dayWord} (${months} ${monthWord})`;
}

/** T4-AC3 — "{DD/MM/YYYY}" derived from `verified_at`, or "Never reviewed". */
function formatLastReviewed(lastReviewedAt: string | null): string {
  return formatDateUK(lastReviewedAt) || 'Never reviewed';
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PerItemSkeleton() {
  return (
    <div className="space-y-4" data-testid="per-item-skeleton">
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PerItemTab() {
  const [inputValue, setInputValue] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useItemProvenance(selectedItemId);

  function handleSearch() {
    const trimmed = inputValue.trim();
    if (UUID_RE.test(trimmed)) {
      setSelectedItemId(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleSearch();
  }

  const isValidInput = UUID_RE.test(inputValue.trim());

  return (
    <div className="space-y-6">
      {/* Item lookup */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Paste a content item UUID to inspect..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Content item UUID"
          />
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={!isValidInput}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Look up
        </button>
      </div>

      {/* States */}
      {!selectedItemId && (
        <div className="rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Enter a content item UUID above to view its provenance data.
          </p>
        </div>
      )}

      {selectedItemId && isLoading && <PerItemSkeleton />}

      {selectedItemId && isError && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
          role="alert"
        >
          <p className="text-sm text-destructive">
            {(error as Error)?.message?.includes('404')
              ? 'This item no longer exists.'
              : (error as Error)?.message?.includes('403')
                ? 'Not authorised to view provenance data.'
                : 'Failed to load provenance data. Please try again.'}
          </p>
        </div>
      )}

      {selectedItemId && data && !isLoading && (
        <div className="space-y-4">
          {/* Item header */}
          <p className="text-xs text-muted-foreground">Item: {data.itemId}</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Classification card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Classification</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-0.5">
                  <PerItemField
                    label="Confidence"
                    value={formatConfidence(data.classification.confidence)}
                  />
                  <PerItemField
                    label="Primary"
                    value={
                      data.classification.primaryDomain
                        ? `${data.classification.primaryDomain} / ${data.classification.primarySubtopic ?? '—'}`
                        : null
                    }
                  />
                  <PerItemField
                    label="Secondary"
                    value={
                      data.classification.secondaryDomain
                        ? `${data.classification.secondaryDomain} / ${data.classification.secondarySubtopic ?? '—'}`
                        : null
                    }
                  />
                  <PerItemField
                    label="Classified at"
                    value={
                      data.classification.classifiedAt
                        ? new Date(
                            data.classification.classifiedAt,
                          ).toLocaleDateString('en-GB')
                        : null
                    }
                  />
                </dl>
                {data.classification.reasoning && (
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Reasoning
                    </p>
                    <p className="whitespace-pre-wrap text-xs text-foreground">
                      {data.classification.reasoning}
                    </p>
                  </div>
                )}
                {!data.classification.confidence &&
                  !data.classification.primaryDomain && (
                    <p className="mt-2 text-xs italic text-muted-foreground/60">
                      This item has not been classified.
                    </p>
                  )}
              </CardContent>
            </Card>

            {/* Processing card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Processing</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-0.5">
                  <PerItemField
                    label="Classification model"
                    value={
                      data.processing.classificationModel
                        ? `${data.processing.classificationModel}${data.processing.classificationModelSource === 'env_default' ? ' (current default)' : ''}`
                        : null
                    }
                  />
                  <PerItemField
                    label="Embedding model"
                    value={
                      data.processing.embeddingModel
                        ? `${data.processing.embeddingModel}${data.processing.embeddingModelSource === 'env_default' ? ' (current default)' : ''}`
                        : null
                    }
                  />
                </dl>
              </CardContent>
            </Card>

            {/* Drafting card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Drafting</CardTitle>
              </CardHeader>
              <CardContent>
                {data.drafting.recentDrafts.length === 0 ? (
                  <p className="text-xs italic text-muted-foreground/60">
                    No bid responses cite this item.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      {data.drafting.totalDraftCount} linked response
                      {data.drafting.totalDraftCount !== 1 ? 's' : ''}
                    </p>
                    {data.drafting.recentDrafts.map((draft) => (
                      <div
                        key={draft.responseId}
                        className="rounded border p-2 text-xs"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">
                            {draft.attribution.kind === 'claude'
                              ? 'Drafted by Knowledge Hub'
                              : `Drafted by ${draft.attribution.label}`}
                          </span>
                          {draft.draftedAt && (
                            <span className="shrink-0 text-muted-foreground">
                              {new Date(draft.draftedAt).toLocaleDateString(
                                'en-GB',
                              )}
                            </span>
                          )}
                        </div>
                        {draft.procurementName && (
                          <p className="mt-1 text-muted-foreground">
                            Procurement: {draft.procurementName}
                          </p>
                        )}
                        {draft.questionText && (
                          <p className="mt-0.5 truncate text-muted-foreground">
                            Q: {draft.questionText}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Review Schedule card — P0 Document Control §5.5 Phase 3 T4 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Review Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-0.5">
                  <PerItemField
                    label="Next review date"
                    value={formatNextReviewDate(
                      data.reviewSchedule.nextReviewDate,
                    )}
                  />
                  <PerItemField
                    label="Review cadence"
                    value={formatReviewCadence(
                      data.reviewSchedule.reviewCadenceDays,
                      data.reviewSchedule.nextReviewDate,
                    )}
                  />
                  <PerItemField
                    label="Last reviewed"
                    value={formatLastReviewed(
                      data.reviewSchedule.lastReviewedAt,
                    )}
                  />
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
