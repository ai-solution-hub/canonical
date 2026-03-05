'use client';

import { forwardRef } from 'react';
import { Check } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DomainBadge } from '@/components/domain-badge';
import { ContentRenderer } from '@/components/content-renderer';
import { getDisplayTitle, formatDateUK, getConfidenceDisplay } from '@/lib/format';
import type { ReviewQueueItem } from '@/types/review';

interface ReviewCardProps {
  item: ReviewQueueItem;
  position: number;
  total: number;
  className?: string;
}

/** Pre-process Q&A prefixes to markdown bold before rendering */
function formatQaPrefixes(content: string): string {
  return content.replace(
    /^(Q:|Standard:|Advanced:|A:)\s*/gm,
    '**$1** ',
  );
}

function ContentBody({ content }: { content: string | null }) {
  if (!content) {
    return (
      <p className="text-sm italic text-muted-foreground">No content available</p>
    );
  }

  const processed = formatQaPrefixes(content);

  return (
    <div className="text-sm leading-relaxed">
      <ContentRenderer content={processed} className="text-sm" />
    </div>
  );
}

/**
 * Single content item display card for the review workflow.
 * Shows domain, content type, classification, provenance, and verification status.
 */
export const ReviewCard = forwardRef<HTMLDivElement, ReviewCardProps>(
  function ReviewCard({ item, position, total, className = '' }, ref) {
    const title = getDisplayTitle({
      suggested_title: item.suggested_title,
      title: item.title,
      content: item.content,
    });

    const confidence = getConfidenceDisplay(item.classification_confidence);
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;

    const sourceFile = metadata.source_file as string | undefined;
    const sectionName = metadata.section_name as string | undefined;
    const importBatch = metadata.import_batch as string | undefined;

    return (
      <Card
        ref={ref}
        tabIndex={-1}
        className={`mx-auto max-w-[800px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none ${className}`}
        role="article"
        aria-label={`Review item ${position} of ${total}: ${title}`}
      >
        <CardHeader className="gap-3">
          {/* Header row: badges + position */}
          <div className="flex flex-wrap items-center gap-2">
            {item.primary_domain && (
              <DomainBadge domain={item.primary_domain} />
            )}
            {item.content_type && (
              <Badge variant="secondary" className="text-xs">
                {item.content_type.replace(/_/g, ' ')}
              </Badge>
            )}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              #{position} of {total.toLocaleString('en-GB')}
            </span>
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>

          {/* Verification status (if already verified) */}
          {item.verified_at && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--success,hsl(142_71%_45%))]">
              <Check className="size-3.5" aria-hidden="true" />
              <span>
                Verified on {formatDateUK(item.verified_at)}
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/* Content body */}
          <section>
            <ContentBody content={item.content} />
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
                    <span className="text-muted-foreground"> &gt; {item.primary_subtopic}</span>
                  )}
                </div>
              )}
              {item.secondary_domain && (
                <div>
                  <span className="text-muted-foreground">Secondary: </span>
                  <span className="font-medium">{item.secondary_domain}</span>
                  {item.secondary_subtopic && (
                    <span className="text-muted-foreground"> &gt; {item.secondary_subtopic}</span>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Confidence: </span>
                <span className={`font-medium ${confidence.colourClass}`}>
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
                      <span className="text-muted-foreground"> &gt; {sectionName}</span>
                    )}
                  </div>
                )}
                {importBatch && (
                  <div>
                    <span className="text-muted-foreground">Import batch: </span>
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
