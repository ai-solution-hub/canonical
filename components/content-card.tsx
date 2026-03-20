'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Thumbnail } from '@/components/thumbnail';
import { DomainBadge } from '@/components/domain-badge';
import { SimilarityBadge } from '@/components/similarity-badge';
import { StarButton } from '@/components/star-button';
import { PriorityBadge } from '@/components/priority-selector';
import { VerificationBadge } from '@/components/verification-badge';
import { getDisplayTitle, formatSmartDate, formatContentType, formatPlatform } from '@/lib/format';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { ContentTypeIcon } from '@/components/content-type-icon';
import { FreshnessBadge } from '@/components/freshness-badge';
import { GovernanceBadge } from '@/components/governance-badge';
import { QualityBadge } from '@/components/quality-badge';
import { calculateQualityScore } from '@/lib/quality-score';
import { AlertTriangle, Copy, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { highlightTerms } from '@/lib/highlight';
import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { Badge } from '@/components/ui/badge';
import type { ContentListItem, SearchResult } from '@/types/content';

// ---------------------------------------------------------------------------
// Internal helpers and sub-components
// ---------------------------------------------------------------------------

function isSearchResult(item: ContentListItem | SearchResult): item is SearchResult {
  return 'similarity' in item;
}

/** Derive a composite quality score from the fields available on a list item */
function qualityScoreForItem(item: ContentListItem | SearchResult) {
  const meta = item.metadata as Record<string, unknown> | null;
  return calculateQualityScore({
    freshness: item.freshness,
    classification_confidence: item.classification_confidence,
    brief: item.brief,
    // detail + reference are not fetched for list views — omitted intentionally
    ai_summary: item.ai_summary,
    citation_count:
      typeof meta?.citation_count === 'number' ? meta.citation_count : 0,
  });
}

/** Reusable quality flag badge */
function QualityFlagBadge() {
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full border border-quality-severity-warning bg-quality-moderate-bg px-1.5 py-0.5 text-[10px] font-medium text-quality-severity-warning"
      title="Has quality issues"
    >
      <AlertTriangle className="size-2.5" aria-hidden="true" />
      <span>Quality</span>
    </span>
  );
}

/** Unread indicator dot */
function UnreadDot({ isRead }: { isRead?: boolean }) {
  if (isRead !== false) return null;
  return (
    <span
      className="size-3 rounded-full bg-primary shadow-sm ring-2 ring-background animate-pulse"
      aria-label="Unread"
    />
  );
}

/** Hover-reveal star toggle */
function StarToggle({ itemId, metadata, className }: {
  itemId: string;
  metadata: Record<string, unknown> | null;
  className?: string;
}) {
  return (
    <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
      <StarButton itemId={itemId} starred={metadata?.starred === true} size="sm" className={className} />
    </span>
  );
}

/** Layer badge (shown when content_layers feature is enabled) */
function LayerBadge({ metadata }: { metadata: Record<string, unknown> | null }) {
  const { getLayerLabel } = useLayerVocabulary();
  if (!isFeatureEnabled('content_layers') || !metadata?.layer) return null;
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-confidence-needs-sme-border text-confidence-needs-sme">
      {getLayerLabel(metadata.layer as string)}
    </Badge>
  );
}

/** Header row: content type icon, domain badge, layer badge, unread dot, star */
function CardHeaderRow({ item, isRead }: { item: ContentListItem | SearchResult; isRead?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <ContentTypeIcon contentType={item.content_type} size="size-5" />
      <DomainBadge domain={item.primary_domain ?? ''} />
      <LayerBadge metadata={item.metadata} />
      <div className="ml-auto flex items-center gap-1">
        <UnreadDot isRead={isRead} />
        <StarToggle itemId={item.id} metadata={item.metadata} />
      </div>
    </div>
  );
}

/** Card title with priority badge and optional Q: prefix */
function CardTitle({ title, priority, qaPrefix, renderText }: {
  title: string;
  priority: string | null;
  qaPrefix?: boolean;
  renderText: (text: string) => React.ReactNode;
}) {
  return (
    <h3 className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
      <PriorityBadge priority={priority} />
      <span className="line-clamp-2">
        {qaPrefix && <span className="text-muted-foreground">Q:&nbsp;</span>}
        {renderText(title)}
      </span>
    </h3>
  );
}

/** Summary or snippet preview text */
function SummaryPreview({ item, renderText }: {
  item: ContentListItem | SearchResult;
  renderText: (text: string) => React.ReactNode;
}) {
  if (isSearchResult(item) && item.snippet) {
    return (
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        <span className="italic text-muted-foreground/70">&hellip;</span>
        {renderText(item.snippet)}
        <span className="italic text-muted-foreground/70">&hellip;</span>
      </p>
    );
  }
  if (item.brief || item.ai_summary) {
    return (
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {renderText(item.brief || item.ai_summary || '')}
      </p>
    );
  }
  return null;
}

/** Content type + platform line */
function ContentTypeLine({ item }: { item: ContentListItem | SearchResult }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <ContentTypeIcon contentType={item.content_type} size="size-3" />
      {[formatContentType(item.content_type), formatPlatform(item.platform)]
        .filter(Boolean)
        .reduce<React.ReactNode[]>((acc, part, i) => {
          if (i > 0) acc.push(<span key={`sep-${i}`} aria-hidden="true"> &middot; </span>);
          acc.push(<span key={i}>{part}</span>);
          return acc;
        }, [])}
    </span>
  );
}

/** Status row: date, freshness always visible; governance, quality, similarity on hover */
function CardStatusRow({ item, hasQualityFlag, children }: {
  item: ContentListItem | SearchResult;
  hasQualityFlag?: boolean;
  children?: React.ReactNode;
}) {
  const hasSecondaryBadges =
    item.governance_review_status === 'pending' ||
    item.governance_review_status === 'draft' ||
    hasQualityFlag ||
    isSearchResult(item);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <time className="text-xs text-muted-foreground" dateTime={item.captured_date ?? undefined}>
        {formatSmartDate(item.captured_date)}
      </time>
      <QualityBadge score={qualityScoreForItem(item)} />
      {children}
      {item.freshness && item.freshness !== 'fresh' && (
        <FreshnessBadge freshness={item.freshness} compact />
      )}
      {hasSecondaryBadges && (
        <span className="inline-flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {isSearchResult(item) && <SimilarityBadge score={item.similarity} />}
          {item.governance_review_status === 'pending' && <GovernanceBadge status="pending" compact />}
          {item.governance_review_status === 'draft' && <GovernanceBadge status="draft" compact />}
          {hasQualityFlag && <QualityFlagBadge />}
        </span>
      )}
    </div>
  );
}

/** Card footer: badges row, author, content type line, status row (shared by compact + standard) */
function CardFooter({ item, hasQualityFlag, badgeSlot }: {
  item: ContentListItem | SearchResult;
  hasQualityFlag?: boolean;
  badgeSlot?: React.ReactNode;
}) {
  return (
    <div className="mt-auto flex flex-col gap-1.5 pt-1">
      <div className="flex items-center gap-1.5 flex-wrap">
        {badgeSlot}
        {item.verified_at && (
          <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <VerificationBadge verified={true} size="sm" />
          </span>
        )}
      </div>
      {item.author_name && (
        <span className="truncate text-xs font-medium text-foreground">{item.author_name}</span>
      )}
      <ContentTypeLine item={item} />
      <CardStatusRow item={item} hasQualityFlag={hasQualityFlag} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

/** Content types that use compact card layout (no thumbnail, 4px left border only) */
export const COMPACT_CONTENT_TYPES = new Set([
  'q_a_pair', 'policy', 'certification', 'compliance',
  'methodology', 'capability', 'product_description', 'case_study',
]);

interface ContentCardProps {
  item: ContentListItem | SearchResult;
  isRead?: boolean;
  hasQualityFlag?: boolean;
  hideThumbnail?: boolean;
  highlightQuery?: string;
}

export const ContentCard = memo(function ContentCard({ item, isRead, hasQualityFlag, hideThumbnail, highlightQuery }: ContentCardProps) {
  const { getDomainColourKey } = useTaxonomy();
  const title = getDisplayTitle(item);
  const renderText = (text: string) =>
    highlightQuery ? highlightTerms(text, highlightQuery) : text;
  const colourKey = item.primary_domain ? getDomainColourKey(item.primary_domain) : 'meta';

  const isQAPair = item.content_type === 'q_a_pair';
  const isCompactType = COMPACT_CONTENT_TYPES.has(item.content_type ?? '');
  const shouldHideThumbnail = isCompactType || hideThumbnail;

  const answerPreview = isQAPair ? (item.content || item.brief || item.ai_summary || null) : null;
  const sourceDocument = isQAPair ? item.source_document : null;

  const cardClassName = cn(
    'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isRead && 'opacity-75',
  );

  const cardStyle = (intrinsicHeight: string) => ({
    contentVisibility: 'auto' as const,
    containIntrinsicSize: `0 ${intrinsicHeight}`,
    borderLeftWidth: '4px',
    borderLeftColor: `var(--domain-${colourKey}-text)`,
  });

  // --- Q&A PAIR CARD ---
  if (isQAPair) {
    return (
      <Link href={`/item/${item.id}`} prefetch={true} className={cardClassName} style={cardStyle('180px')}>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <CardHeaderRow item={item} isRead={isRead} />
          <CardTitle title={title} priority={item.priority} qaPrefix renderText={renderText} />
          {answerPreview && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-muted-foreground">A:&nbsp;</span>
              {renderText(answerPreview)}
            </p>
          )}
          {sourceDocument && (
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
              <FileText className="size-3 shrink-0" aria-hidden="true" />
              {sourceDocument}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-1.5 pt-1">
            <ContentTypeLine item={item} />
            <CardStatusRow item={item} hasQualityFlag={hasQualityFlag}>
              {answerPreview && (
                <button
                  type="button"
                  aria-label="Copy answer to clipboard"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(answerPreview).then(
                      () => toast.success('Answer copied to clipboard'),
                      () => toast.error('Failed to copy to clipboard'),
                    );
                  }}
                >
                  <Copy className="size-3.5 text-muted-foreground hover:text-foreground" aria-hidden="true" />
                </button>
              )}
              {item.verified_at && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <VerificationBadge verified={true} size="sm" />
                </span>
              )}
            </CardStatusRow>
          </div>
        </div>
      </Link>
    );
  }

  // --- COMPACT CARD (non-Q&A compact types) ---
  if (isCompactType) {
    return (
      <Link href={`/item/${item.id}`} prefetch={true} className={cardClassName} style={cardStyle('200px')}>
        <div className="flex flex-1 flex-col gap-2 p-3">
          <CardHeaderRow item={item} isRead={isRead} />
          <CardTitle title={title} priority={item.priority} renderText={renderText} />
          <SummaryPreview item={item} renderText={renderText} />
          <CardFooter item={item} hasQualityFlag={hasQualityFlag} />
        </div>
      </Link>
    );
  }

  // --- STANDARD CARD (thumbnail-eligible types) ---
  return (
    <Link href={`/item/${item.id}`} prefetch={true} className={cardClassName} style={cardStyle(shouldHideThumbnail ? '200px' : '320px')}>
      {!shouldHideThumbnail ? (
        <div className="relative">
          <Thumbnail src={item.thumbnail_url} alt={title} contentType={item.content_type} domain={item.primary_domain} placeholderAspect="compact" className="rounded-b-none" />
          <div className="absolute right-1 top-1 flex items-center gap-1">
            <UnreadDot isRead={isRead} />
            <StarToggle itemId={item.id} metadata={item.metadata} className="rounded-full bg-background/80 shadow-sm backdrop-blur-sm" />
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-1 p-3 pb-0">
          <UnreadDot isRead={isRead} />
          <StarToggle itemId={item.id} metadata={item.metadata} />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <CardTitle title={title} priority={item.priority} renderText={renderText} />
        <SummaryPreview item={item} renderText={renderText} />
        <CardFooter
          item={item}
          hasQualityFlag={hasQualityFlag}
          badgeSlot={<><DomainBadge domain={item.primary_domain ?? ''} /><LayerBadge metadata={item.metadata} /></>}
        />
      </div>
    </Link>
  );
});
