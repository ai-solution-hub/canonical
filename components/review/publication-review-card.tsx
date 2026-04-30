'use client';

import { useMemo } from 'react';
import { FileText, ExternalLink, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { PublicationStatusBadge } from '@/components/shared/publication-status-badge';
import type { ReviewQueueItem } from '@/types/review';

/**
 * Per-row card for the "Awaiting publication" tab on /review.
 *
 * Spec §7 of `docs/specs/review-page-tabs-refactor-spec.md` describes the
 * card content as: title, domain/subtopic chips, source file, classification
 * confidence, ingest pipeline-run link, freshness signal (`updated_at`),
 * markdown preview (truncated). The publication-status badge from
 * `components/shared/publication-status-badge.tsx` is reused at the top of
 * the card.
 *
 * The action bar (`<PublicationReviewActionBar />`) is rendered alongside
 * the card by the parent queue component, NOT inside the card — this keeps
 * the card a pure data render and makes the action set easier to swap if
 * the spec evolves.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7.
 */

interface PublicationReviewCardProps {
  item: ReviewQueueItem;
  className?: string;
}

const PREVIEW_CHARS = 480;

function formatPercent(confidence: number | null): string | null {
  if (confidence === null || Number.isNaN(confidence)) return null;
  return `${Math.round(confidence * 100)}%`;
}

function formatUpdatedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  // UK English DD/MM/YYYY per CLAUDE.md.
  return new Date(parsed).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function PublicationReviewCard({
  item,
  className,
}: PublicationReviewCardProps) {
  const preview = useMemo(() => {
    if (!item.content) return null;
    if (item.content.length <= PREVIEW_CHARS) return item.content;
    return `${item.content.slice(0, PREVIEW_CHARS).trimEnd()}…`;
  }, [item.content]);

  const confidencePercent = formatPercent(item.classification_confidence);
  const updatedAtLabel = formatUpdatedAt(item.last_reviewed_at);

  // Best-effort pipeline-run linking. The review-queue REST mapper does
  // not expose `pipeline_run_id` directly, so the card surfaces the
  // ingest source from `ingest_source` metadata when the row is from a
  // markdown batch (EP2). When neither field is present we omit the row.
  const metadata = (item.metadata ?? {}) as Record<string, unknown>;
  const pipelineRunId =
    typeof metadata.pipeline_run_id === 'string'
      ? (metadata.pipeline_run_id as string)
      : null;
  const ingestSource =
    typeof metadata.ingest_source === 'string'
      ? (metadata.ingest_source as string)
      : null;

  return (
    <article
      className={cn(
        'rounded-xl border border-border bg-card p-5 shadow-sm',
        className,
      )}
      aria-label={`Awaiting publication: ${item.title ?? 'Untitled'}`}
    >
      {/* Header row: status badge + title */}
      <div className="flex flex-wrap items-start gap-2">
        <PublicationStatusBadge status={item.publication_status} />
        {confidencePercent && (
          <Badge
            variant="outline"
            className="gap-1 text-[11px] font-medium"
            aria-label={`Classification confidence ${confidencePercent}`}
          >
            <ShieldCheck className="size-3" aria-hidden="true" />
            {confidencePercent}
          </Badge>
        )}
      </div>

      <h2 className="mt-3 text-lg font-semibold text-foreground">
        {item.title || item.suggested_title || 'Untitled'}
      </h2>

      {/* Classification chips */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.primary_domain && (
          <Badge variant="secondary" className="text-[11px]">
            {item.primary_domain}
          </Badge>
        )}
        {item.primary_subtopic && (
          <Badge variant="outline" className="text-[11px]">
            {item.primary_subtopic}
          </Badge>
        )}
        {item.content_type && (
          <Badge variant="outline" className="text-[11px]">
            {item.content_type.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>

      {/* Markdown preview (truncated) */}
      {preview && (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {preview}
        </p>
      )}

      {/* Provenance / freshness footer */}
      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs sm:grid-cols-2">
        {ingestSource && (
          <div className="flex items-center gap-1.5">
            <FileText
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <dt className="font-medium text-muted-foreground">Ingest source:</dt>
            <dd className="text-foreground">{ingestSource}</dd>
          </div>
        )}
        {pipelineRunId && (
          <div className="flex items-center gap-1.5">
            <ExternalLink
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <dt className="font-medium text-muted-foreground">Pipeline run:</dt>
            <dd className="font-mono text-foreground">
              {pipelineRunId.slice(0, 8)}
            </dd>
          </div>
        )}
        {updatedAtLabel && (
          <div className="flex items-center gap-1.5">
            <dt className="font-medium text-muted-foreground">Last activity:</dt>
            <dd className="text-foreground">{updatedAtLabel}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}
