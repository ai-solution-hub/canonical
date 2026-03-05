'use client';

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
import { AlertTriangle, Copy, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ContentListItem, SearchResult } from '@/types/content';

/** Content types that use compact card layout (no thumbnail, 4px left border only) */
export const COMPACT_CONTENT_TYPES = new Set([
  'q_a_pair',
  'policy',
  'certification',
  'compliance',
  'methodology',
  'capability',
  'product_description',
  'case_study',
]);

interface ContentCardProps {
  item: ContentListItem | SearchResult;
  isRead?: boolean;
  hasQualityFlag?: boolean;
  hideThumbnail?: boolean;
}

function isSearchResult(
  item: ContentListItem | SearchResult,
): item is SearchResult {
  return 'similarity' in item;
}

export function ContentCard({ item, isRead, hasQualityFlag, hideThumbnail }: ContentCardProps) {
  const { getDomainColourKey } = useTaxonomy();
  const title = getDisplayTitle(item);
  const colourKey = item.primary_domain
    ? getDomainColourKey(item.primary_domain)
    : 'meta';

  const isQAPair = item.content_type === 'q_a_pair';
  const isCompactType = COMPACT_CONTENT_TYPES.has(item.content_type ?? '');
  // Compact types always hide thumbnail; non-compact respect the hideThumbnail prop
  const shouldHideThumbnail = isCompactType || hideThumbnail;

  // Answer text for Q&A cards: prefer content, fall back to brief, then ai_summary
  const answerPreview = isQAPair
    ? (item.content || item.brief || item.ai_summary || null)
    : null;

  // Source document for Q&A cards
  const sourceDocument = isQAPair ? item.source_document : null;

  // --- Q&A PAIR CARD ---
  if (isQAPair) {
    return (
      <Link
        href={`/item/${item.id}`}
        prefetch={true}
        className={cn(
          'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isRead && 'opacity-75',
        )}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: '0 180px',
          borderLeftWidth: '4px',
          borderLeftColor: `var(--domain-${colourKey}-text)`,
        }}
      >
        <div className="flex flex-1 flex-col gap-2 p-3">
          {/* Header: content type icon, domain badge, unread dot, star */}
          <div className="flex items-center gap-1.5">
            <ContentTypeIcon contentType={item.content_type} size="size-5" />
            <DomainBadge domain={item.primary_domain ?? ''} />
            <div className="ml-auto flex items-center gap-1">
              {isRead === false && (
                <span
                  className="size-2.5 rounded-full bg-primary shadow-sm ring-2 ring-background"
                  aria-label="Unread"
                />
              )}
              <span className="opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <StarButton
                  itemId={item.id}
                  starred={item.metadata?.starred === true}
                  size="sm"
                />
              </span>
            </div>
          </div>

          {/* Question title */}
          <h3 className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
            <PriorityBadge priority={item.priority} />
            <span className="line-clamp-2">
              <span className="text-muted-foreground">Q:&nbsp;</span>
              {title}
            </span>
          </h3>

          {/* Answer preview */}
          {answerPreview && (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-muted-foreground">A:&nbsp;</span>
              {answerPreview}
            </p>
          )}

          {/* Source document */}
          {sourceDocument && (
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
              <FileText className="size-3 shrink-0" aria-hidden="true" />
              {sourceDocument}
            </p>
          )}

          {/* Footer: content type + platform, date, copy, verification, quality */}
          <div className="mt-auto flex flex-col gap-1.5 pt-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ContentTypeIcon contentType={item.content_type} size="size-3" />
              {[formatContentType(item.content_type), formatPlatform(item.platform)]
                .filter(Boolean)
                .join(' \u00B7 ')}
            </span>
            <div className="flex items-center gap-2">
              <time
                className="text-xs text-muted-foreground"
                dateTime={item.captured_date ?? undefined}
              >
                {formatSmartDate(item.captured_date)}
              </time>
              {answerPreview && (
                <button
                  type="button"
                  aria-label="Copy answer to clipboard"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigator.clipboard.writeText(answerPreview);
                    toast.success('Answer copied to clipboard');
                  }}
                >
                  <Copy className="size-3.5 text-muted-foreground hover:text-foreground" aria-hidden="true" />
                </button>
              )}
              {item.verified_at && (
                <VerificationBadge verified={true} size="sm" />
              )}
              {item.freshness && item.freshness !== 'fresh' && (
                <FreshnessBadge freshness={item.freshness} compact />
              )}
              {item.governance_review_status === 'pending' && (
                <GovernanceBadge status="pending" compact />
              )}
              {hasQualityFlag && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                  title="Has quality issues"
                >
                  <AlertTriangle className="size-2.5" aria-hidden="true" />
                  <span>Quality</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // --- COMPACT CARD (non-Q&A compact types) ---
  if (isCompactType) {
    return (
      <Link
        href={`/item/${item.id}`}
        prefetch={true}
        className={cn(
          'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isRead && 'opacity-75',
        )}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: '0 200px',
          borderLeftWidth: '4px',
          borderLeftColor: `var(--domain-${colourKey}-text)`,
        }}
      >
        <div className="flex flex-1 flex-col gap-2 p-3">
          {/* Header: content type icon, domain badge, unread dot, star */}
          <div className="flex items-center gap-1.5">
            <ContentTypeIcon contentType={item.content_type} size="size-5" />
            <DomainBadge domain={item.primary_domain ?? ''} />
            <div className="ml-auto flex items-center gap-1">
              {isRead === false && (
                <span
                  className="size-2.5 rounded-full bg-primary shadow-sm ring-2 ring-background"
                  aria-label="Unread"
                />
              )}
              <span className="opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                <StarButton
                  itemId={item.id}
                  starred={item.metadata?.starred === true}
                  size="sm"
                />
              </span>
            </div>
          </div>

          {/* Title */}
          <h3 className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
            <PriorityBadge priority={item.priority} />
            <span className="line-clamp-2">{title}</span>
          </h3>

          {/* Summary text */}
          {isSearchResult(item) && <SimilarityBadge score={item.similarity} />}
          {isSearchResult(item) && item.snippet ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              <span className="italic text-muted-foreground/70">&hellip;</span>
              {item.snippet}
              <span className="italic text-muted-foreground/70">&hellip;</span>
            </p>
          ) : item.brief || item.ai_summary ? (
            <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {item.brief || item.ai_summary}
            </p>
          ) : null}

          {/* Footer */}
          <div className="mt-auto flex flex-col gap-1.5 pt-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.verified_at && (
                <VerificationBadge verified={true} size="sm" />
              )}
            </div>
            {item.author_name && (
              <span className="truncate text-xs font-medium text-foreground">
                {item.author_name}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ContentTypeIcon contentType={item.content_type} size="size-3" />
              {[formatContentType(item.content_type), formatPlatform(item.platform)]
                .filter(Boolean)
                .join(' \u00B7 ')}
            </span>
            <div className="flex items-center gap-2">
              <time
                className="text-xs text-muted-foreground"
                dateTime={item.captured_date ?? undefined}
              >
                {formatSmartDate(item.captured_date)}
              </time>
              {item.freshness && item.freshness !== 'fresh' && (
                <FreshnessBadge freshness={item.freshness} compact />
              )}
              {item.governance_review_status === 'pending' && (
                <GovernanceBadge status="pending" compact />
              )}
              {hasQualityFlag && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                  title="Has quality issues"
                >
                  <AlertTriangle className="size-2.5" aria-hidden="true" />
                  <span>Quality</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // --- STANDARD CARD (thumbnail-eligible types) ---
  return (
    <Link
      href={`/item/${item.id}`}
      prefetch={true}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isRead && 'opacity-75',
      )}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: shouldHideThumbnail ? '0 200px' : '0 320px',
        borderLeftWidth: '4px',
        borderLeftColor: `var(--domain-${colourKey}-text)`,
      }}
    >
      {!shouldHideThumbnail && (
        <div className="relative">
          <Thumbnail
            src={item.thumbnail_url}
            alt={title}
            contentType={item.content_type}
            domain={item.primary_domain}
            className="rounded-b-none"
          />
          <div className="absolute right-1 top-1 flex items-center gap-1">
            {isRead === false && (
              <span
                className="size-2.5 rounded-full bg-primary shadow-sm ring-2 ring-background"
                aria-label="Unread"
              />
            )}
            <span className="opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
              <StarButton
                itemId={item.id}
                starred={item.metadata?.starred === true}
                size="sm"
                className="rounded-full bg-background/80 shadow-sm backdrop-blur-sm"
              />
            </span>
          </div>
        </div>
      )}
      {shouldHideThumbnail && (
        <div className="flex items-center justify-end gap-1 p-3 pb-0">
          {isRead === false && (
            <span
              className="size-2.5 rounded-full bg-primary shadow-sm ring-2 ring-background"
              aria-label="Unread"
            />
          )}
          <span className="opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <StarButton
              itemId={item.id}
              starred={item.metadata?.starred === true}
              size="sm"
            />
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
          <PriorityBadge priority={item.priority} />
          <span className="line-clamp-2">{title}</span>
        </h3>
        {isSearchResult(item) && <SimilarityBadge score={item.similarity} />}
        {isSearchResult(item) && item.snippet ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            <span className="italic text-muted-foreground/70">&hellip;</span>
            {item.snippet}
            <span className="italic text-muted-foreground/70">&hellip;</span>
          </p>
        ) : item.brief || item.ai_summary ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.brief || item.ai_summary}
          </p>
        ) : null}
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <DomainBadge domain={item.primary_domain ?? ''} />
            {item.verified_at && (
              <VerificationBadge verified={true} size="sm" />
            )}
          </div>
          {item.author_name && (
            <span className="truncate text-xs font-medium text-foreground">
              {item.author_name}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ContentTypeIcon contentType={item.content_type} size="size-3" />
            {[formatContentType(item.content_type), formatPlatform(item.platform)]
              .filter(Boolean)
              .join(' \u00B7 ')}
          </span>
          <div className="flex items-center gap-2">
            <time
              className="text-xs text-muted-foreground"
              dateTime={item.captured_date ?? undefined}
            >
              {formatSmartDate(item.captured_date)}
            </time>
            {item.freshness && item.freshness !== 'fresh' && (
              <FreshnessBadge freshness={item.freshness} compact />
            )}
            {item.governance_review_status === 'pending' && (
              <GovernanceBadge status="pending" compact />
            )}
            {hasQualityFlag && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                title="Has quality issues"
              >
                <AlertTriangle className="size-2.5" aria-hidden="true" />
                <span>Quality</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
