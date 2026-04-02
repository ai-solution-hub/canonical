'use client';

import { forwardRef, useState, useRef, useEffect, type ReactNode } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DomainBadge } from '@/components/shared/domain-badge';
import { VerificationBadge } from '@/components/shared/verification-badge';
import { ContentRenderer } from '@/components/item-detail/content-renderer';
import { cn } from '@/lib/utils';
import {
  getDisplayTitle,
  formatDateUK,
  getConfidenceDisplay,
} from '@/lib/format';
import { useDisplayNames } from '@/hooks/use-display-names';
import { ReviewHistorySection } from '@/components/review/review-history-section';
import type { ReviewQueueItem } from '@/types/review';
import type { ReviewHistoryEntry } from '@/hooks/review/use-review-history';

interface ReviewCardProps {
  item: ReviewQueueItem;
  position: number;
  total: number;
  /** Pre-fetched review history entries */
  reviewHistory?: ReviewHistoryEntry[];
  /** Whether review history is still loading */
  reviewHistoryLoading?: boolean;
  className?: string;
}

/** Pre-process Q&A prefixes to markdown bold before rendering */
function formatQaPrefixes(content: string): string {
  return content.replace(/^(Q:|Standard:|Advanced:|A:)\s*/gm, '**$1** ');
}

function ContentBody({ content }: { content: string | null }) {
  if (!content) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No content available
      </p>
    );
  }

  const processed = formatQaPrefixes(content);

  return (
    <div className="text-sm leading-relaxed">
      <ContentRenderer content={processed} className="text-sm" />
    </div>
  );
}

const COLLAPSE_HEIGHT = 300;

/** Collapsible wrapper — use key={itemId} on mount to reset state on item change */
function CollapsibleContent({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Measure content height on mount (key change remounts, resetting state)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () =>
      setNeedsCollapse(el.scrollHeight > COLLAPSE_HEIGHT + 40);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          'overflow-hidden motion-safe:transition-[max-height] motion-safe:duration-300',
        )}
        style={
          !expanded && needsCollapse
            ? { maxHeight: `${COLLAPSE_HEIGHT}px` }
            : undefined
        }
      >
        {children}
      </div>
      {needsCollapse && !expanded && (
        <div className="absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-card to-transparent">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(true)}
            className="mb-1 gap-1"
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
            Show more
          </Button>
        </div>
      )}
      {needsCollapse && expanded && (
        <div className="mt-2 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setExpanded(false);
              contentRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
              });
            }}
            className="gap-1"
          >
            <ChevronUp className="size-3.5" aria-hidden="true" />
            Show less
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Single content item display card for the review workflow.
 * Shows domain, content type, classification, provenance, and verification status.
 */
export const ReviewCard = forwardRef<HTMLDivElement, ReviewCardProps>(
  function ReviewCard(
    {
      item,
      position,
      total,
      reviewHistory,
      reviewHistoryLoading,
      className = '',
    },
    ref,
  ) {
    const title = getDisplayTitle({
      suggested_title: item.suggested_title,
      title: item.title,
      content: item.content,
    });

    // Resolve verified_by UUID to display name
    const displayNames = useDisplayNames([item.verified_by]);
    const verifiedByName = item.verified_by
      ? (displayNames.get(item.verified_by) ?? null)
      : null;

    const confidence = getConfidenceDisplay(item.classification_confidence);
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;

    const sourceFile =
      item.source_file ?? (metadata.source_file as string | undefined);
    const sectionName = metadata.section_name as string | undefined;
    const importBatch = metadata.import_batch as string | undefined;

    return (
      <Card
        ref={ref}
        tabIndex={-1}
        className={cn(
          'mx-auto max-w-[800px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none',
          className,
        )}
        role="article"
        aria-label={`Review item ${position} of ${total}: ${title}`}
      >
        <CardHeader className="gap-3">
          {/* Header row: badges + position */}
          <div className="flex flex-wrap items-center gap-2">
            {item.governance_review_status === 'draft' && (
              <Badge
                variant="outline"
                className="border-draft-badge-border bg-draft-badge-bg text-draft-badge-text text-xs"
              >
                Draft
              </Badge>
            )}
            {item.primary_domain && (
              <DomainBadge domain={item.primary_domain} />
            )}
            {item.content_type && (
              <Badge variant="secondary" className="text-xs">
                {item.content_type.replace(/_/g, ' ')}
              </Badge>
            )}
            {item.classification_confidence != null &&
              item.classification_confidence < 0.7 && (
                <Badge
                  variant="outline"
                  className="border-confidence-low-border bg-confidence-low-bg text-confidence-low text-[10px]"
                  role="status"
                >
                  Low confidence
                </Badge>
              )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              #{position} of {total.toLocaleString('en-GB')}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>

          {/* Verification / review timing */}
          {item.verified_at ? (
            <div className="flex flex-wrap items-center gap-3">
              <VerificationBadge
                verified
                verifiedAt={item.verified_at}
                verifiedByName={verifiedByName}
                size="md"
              />
              <DaysSinceReview
                reviewedAt={item.last_reviewed_at ?? item.verified_at}
              />
            </div>
          ) : item.last_reviewed_at ? (
            <DaysSinceReview reviewedAt={item.last_reviewed_at} />
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-freshness-stale">
              <Clock className="size-3.5" aria-hidden="true" />
              <span>Never reviewed</span>
            </div>
          )}
        </CardHeader>

        {/* Context summary — at-a-glance info */}
        {(item.ai_summary || sourceFile || item.captured_date) && (
          <div className="mx-6 mb-2 rounded-lg border bg-muted/30 px-4 py-3">
            {item.governance_review_status === 'pending' && (
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-governance-pending">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                Governance review pending
              </div>
            )}
            {item.ai_summary && (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {item.ai_summary}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {sourceFile && (
                <span className="flex items-center gap-1">
                  <FileText className="size-3" aria-hidden="true" />
                  {sourceFile}
                </span>
              )}
              {item.captured_date && (
                <span>{formatDateUK(item.captured_date)}</span>
              )}
              {item.classification_confidence != null &&
                (() => {
                  const conf = getConfidenceDisplay(
                    item.classification_confidence,
                  );
                  return <span className={conf.colourClass}>{conf.label}</span>;
                })()}
            </div>
          </div>
        )}

        <CardContent className="flex flex-col gap-6">
          {/* Review history — only shown when there are entries or loading */}
          {(reviewHistoryLoading ||
            (reviewHistory && reviewHistory.length > 0)) && (
            <ReviewHistorySection
              history={reviewHistory ?? []}
              isLoading={reviewHistoryLoading}
            />
          )}

          {/* Content body */}
          <section>
            <CollapsibleContent key={item.id}>
              <ContentBody content={item.content} />
            </CollapsibleContent>
          </section>

          {/* Classification section */}
          <section className="border-t border-border pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Classification
            </h3>
            <div className="flex flex-col gap-1 text-sm">
              {item.primary_domain && (
                <div>
                  <span className="text-muted-foreground">Domain: </span>
                  <span className="font-medium">{item.primary_domain}</span>
                  {item.primary_subtopic && (
                    <span className="text-muted-foreground">
                      {' '}
                      &gt; {item.primary_subtopic}
                    </span>
                  )}
                </div>
              )}
              {item.secondary_domain && (
                <div>
                  <span className="text-muted-foreground">Secondary: </span>
                  <span className="font-medium">{item.secondary_domain}</span>
                  {item.secondary_subtopic && (
                    <span className="text-muted-foreground">
                      {' '}
                      &gt; {item.secondary_subtopic}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Confidence: </span>
                <span className={cn('font-medium', confidence.colourClass)}>
                  {confidence.label}
                </span>
              </div>
            </div>
          </section>

          {/* Provenance section */}
          {(sourceFile || importBatch || item.captured_date) && (
            <section className="border-t border-border pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Provenance
              </h3>
              <div className="flex flex-col gap-1 text-sm">
                {sourceFile && (
                  <div>
                    <span className="text-muted-foreground">Source: </span>
                    <span className="font-medium">{sourceFile}</span>
                    {sectionName && (
                      <span className="text-muted-foreground">
                        {' '}
                        &gt; {sectionName}
                      </span>
                    )}
                  </div>
                )}
                {importBatch && (
                  <div>
                    <span className="text-muted-foreground">
                      Import batch:{' '}
                    </span>
                    <span className="font-mono text-xs">{importBatch}</span>
                  </div>
                )}
                {item.captured_date && (
                  <div>
                    <span className="text-muted-foreground">Imported: </span>
                    <span>{formatDateUK(item.captured_date)}</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </CardContent>
      </Card>
    );
  },
);

// ---------------------------------------------------------------------------
// Days since review helper
// ---------------------------------------------------------------------------

function DaysSinceReview({ reviewedAt }: { reviewedAt: string }) {
  // Capture "now" once on mount to avoid impure Date.now() during re-renders
  const [mountTime] = useState(() => Date.now());
  const days = Math.floor(
    (mountTime - new Date(reviewedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (days === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" aria-hidden="true" />
        Reviewed today
      </span>
    );
  }

  const isOverdue = days > 90;

  return (
    <span
      className={cn(
        'flex items-center gap-1 text-xs',
        isOverdue ? 'text-bid-overdue' : 'text-muted-foreground',
      )}
    >
      <Clock className="size-3" aria-hidden="true" />
      Last reviewed {days} {days === 1 ? 'day' : 'days'} ago
    </span>
  );
}
