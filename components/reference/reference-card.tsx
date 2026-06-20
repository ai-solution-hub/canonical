'use client';

import { memo } from 'react';
import Link from 'next/link';
import { FileText, Rss, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateUK } from '@/lib/format';
import type {
  ReferenceListItem,
  ReferenceIngestionSource,
} from '@/types/reference';

/**
 * Single reference card — the ONE card shape for BOTH the default list
 * (`reference_list`) and search results (`reference_search`), since
 * `ReferenceListItem` carries the search-only score fields as optional
 * (ID-111.5). The card NEVER renders the `embedding_score` / `fulltext_score`
 * fields — they are AI-invisible ranking internals (PRODUCT.md B-23).
 *
 * Echoes the content-card look-and-feel (rounded-lg border, bg-card, group
 * hover lift) using Warm Meridian semantic tokens only — no raw Tailwind
 * colours (B-26). Domain/subtopic/layer badges and the ingestion-source
 * indicator carry text labels, never colour-only (WCAG 2.1 AA, B-26).
 *
 * Spec: PRODUCT.md B-11, B-17, B-23, B-26, B-27.
 */

/**
 * Plain-language ingestion-source indicator (B-17) — never the raw enum.
 * `'URL import'` / `'RSS feed'` per the spec's filter-label vocabulary.
 */
function ingestionSourceMeta(source: ReferenceIngestionSource): {
  label: string;
  Icon: typeof Rss;
} {
  switch (source) {
    case 'rss_feed':
      return { label: 'RSS feed', Icon: Rss };
    case 'url_import':
      return { label: 'URL import', Icon: Link2 };
    default:
      return { label: 'Source document', Icon: FileText };
  }
}

interface ReferenceCardProps {
  reference: ReferenceListItem;
}

export const ReferenceCard = memo(function ReferenceCard({
  reference,
}: ReferenceCardProps) {
  const preview = reference.summary_preview || reference.body_preview || null;
  const publishedLabel = reference.published_at
    ? formatDateUK(reference.published_at)
    : 'No publication date';
  const { label: sourceLabel, Icon: SourceIcon } = ingestionSourceMeta(
    reference.ingestion_source,
  );

  return (
    <Link
      href={`/reference/${reference.reference_id}`}
      prefetch={false}
      className="group flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--border)' }}
    >
      {(reference.primary_domain ||
        reference.primary_subtopic ||
        reference.layer) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {reference.primary_domain && (
            <Badge variant="secondary" className="text-[10px]">
              {reference.primary_domain}
            </Badge>
          )}
          {reference.primary_subtopic && (
            <Badge variant="outline" className="text-[10px]">
              {reference.primary_subtopic}
            </Badge>
          )}
          {reference.layer && (
            <Badge variant="outline" className="text-[10px]">
              {reference.layer}
            </Badge>
          )}
        </div>
      )}

      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {reference.title}
      </h3>

      {preview && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {preview}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <SourceIcon className="size-3 shrink-0" aria-hidden="true" />
          {sourceLabel}
        </span>
        <span>{publishedLabel}</span>
      </div>
    </Link>
  );
});
