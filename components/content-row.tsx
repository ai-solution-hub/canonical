'use client';

import { memo } from 'react';
import Link from 'next/link';
import { ThumbnailSmall } from '@/components/thumbnail';
import { DomainBadge } from '@/components/domain-badge';
import { SimilarityBadge } from '@/components/similarity-badge';
import { StarButton } from '@/components/star-button';
import { PriorityBadge } from '@/components/priority-selector';
import { getDisplayTitle, formatDate, formatSmartDate, formatContentType } from '@/lib/format';
import { ContentTypeIcon } from '@/components/content-type-icon';
import { AlertTriangle, Copy } from 'lucide-react';
import { FreshnessBadge } from '@/components/freshness-badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { highlightTerms } from '@/lib/highlight';
import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { Badge } from '@/components/ui/badge';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import type { ContentListItem, SearchResult } from '@/types/content';
import type { OnOptimisticUpdate } from '@/hooks/use-quick-review';
import { QuickReviewActions } from '@/components/quick-review-actions';
import type { ActiveBidWorkspace } from '@/hooks/use-quick-assign';
import { QuickAssignButton } from '@/components/quick-assign-button';

interface ContentRowProps {
  item: ContentListItem | SearchResult;
  isActive?: boolean;
  isRead?: boolean;
  hasQualityFlag?: boolean;
  highlightQuery?: string;
  /** Whether the current user can edit. Enables quick review actions. */
  canEdit?: boolean;
  /** Callback for optimistic item state updates */
  onQuickReviewUpdate?: OnOptimisticUpdate;
  /** Active bid workspaces for quick-assign (from parent context) */
  activeWorkspaces?: ActiveBidWorkspace[];
  /** Set of workspace IDs this item is assigned to */
  assignedWorkspaceIds?: Set<string>;
  /** Callback when workspace assignment changes */
  onAssignmentChange?: (itemId: string, workspaceId: string, workspaceName: string) => void;
}

function isSearchResult(
  item: ContentListItem | SearchResult,
): item is SearchResult {
  return 'similarity' in item;
}

export const ContentRow = memo(function ContentRow({
  item,
  isActive = false,
  isRead,
  hasQualityFlag,
  highlightQuery,
  canEdit,
  onQuickReviewUpdate,
  activeWorkspaces,
  assignedWorkspaceIds,
  onAssignmentChange,
}: ContentRowProps) {
  const { getDomainColourKey } = useTaxonomy();
  const { getLayerLabel } = useLayerVocabulary();
  const title = getDisplayTitle(item);
  const isQAPair = item.content_type === 'q_a_pair';
  const colourKey = item.primary_domain
    ? getDomainColourKey(item.primary_domain)
    : 'meta';

  /** Conditionally highlight text when a query is provided */
  const renderText = (text: string) =>
    highlightQuery ? highlightTerms(text, highlightQuery) : text;

  // Answer snippet for Q&A rows
  const answerSnippet = isQAPair
    ? (item.content || item.brief || item.ai_summary || null)
    : null;

  // --- Q&A PAIR ROW ---
  if (isQAPair) {
    return (
      <Link
        href={`/item/${item.id}`}
        prefetch={true}
        className={cn(
          'group flex min-w-0 flex-1 items-center gap-3 border-b border-border px-4 py-2 transition-colors duration-100 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isActive && 'bg-accent/50',
        )}
        style={{
          height: '64px',
          borderLeftWidth: '4px',
          borderLeftColor: `var(--domain-${colourKey}-text)`,
        }}
      >
        <ThumbnailSmall
          src={item.thumbnail_url}
          alt={title}
          contentType={item.content_type}
          domain={item.primary_domain}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={item.priority} />
            <span
              className={cn(
                'truncate text-sm text-foreground',
                isRead === false ? 'font-semibold' : 'font-normal',
              )}
            >
              <span className="text-muted-foreground">Q:&nbsp;</span>
              {renderText(title)}
            </span>
            <DomainBadge
              domain={item.primary_domain ?? ''}
              className="shrink-0"
            />
            {isSearchResult(item) && (
              <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">Q&amp;A</Badge>
            )}
            {isFeatureEnabled('content_layers') && !!item.metadata?.layer && (
              <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 border-confidence-needs-sme-border text-confidence-needs-sme">
                {getLayerLabel(item.metadata.layer as string)}
              </Badge>
            )}
            {isSearchResult(item) && (
              <SimilarityBadge score={item.similarity} className="shrink-0" />
            )}
            {item.freshness && item.freshness !== 'fresh' && (
              <FreshnessBadge freshness={item.freshness} compact className="shrink-0" />
            )}
            {hasQualityFlag && (
              <AlertTriangle
                className="size-3 shrink-0 text-quality-severity-warning"
                aria-label="Has quality issues"
              />
            )}
          </div>
          <span
            className={cn(
              'truncate text-xs',
              isRead ? 'text-muted-foreground/60' : 'text-muted-foreground',
            )}
          >
            {isSearchResult(item) && item.snippet ? (
              renderText(`\u2026${item.snippet}\u2026`)
            ) : answerSnippet ? (
              <span className="flex items-center gap-1">
                <span className="font-medium">A:</span>
                <span className="truncate">{renderText(answerSnippet)}</span>
              </span>
            ) : item.source_document ? (
              <span className="flex items-center gap-1">
                <ContentTypeIcon contentType={item.content_type} size="size-3" />
                {item.source_document}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <ContentTypeIcon contentType={item.content_type} size="size-3" />
                {formatContentType(item.content_type)}
              </span>
            )}
          </span>
        </div>
        <time
          className={cn(
            'shrink-0 text-xs',
            isRead ? 'text-muted-foreground/60' : 'text-muted-foreground',
          )}
          dateTime={item.captured_date ?? undefined}
        >
          {formatSmartDate(item.captured_date)}
        </time>
        {activeWorkspaces && assignedWorkspaceIds && (
          <QuickAssignButton
            itemId={item.id}
            activeWorkspaces={activeWorkspaces}
            assignedWorkspaceIds={assignedWorkspaceIds}
            onAssignmentChange={onAssignmentChange}
            className="shrink-0"
          />
        )}
        {answerSnippet && (
          <button
            type="button"
            aria-label="Copy answer to clipboard"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigator.clipboard.writeText(answerSnippet).then(
                () => toast.success('Answer copied to clipboard'),
                () => toast.error('Failed to copy to clipboard'),
              );
            }}
          >
            <Copy className="size-3.5 text-muted-foreground hover:text-foreground" aria-hidden="true" />
          </button>
        )}
        {canEdit && (
          <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
            <QuickReviewActions
              itemId={item.id}
              itemTitle={getDisplayTitle(item)}
              verifiedAt={item.verified_at}
              hasQualityFlag={hasQualityFlag}
              onOptimisticUpdate={onQuickReviewUpdate}
              canEdit={canEdit}
            />
          </span>
        )}
        <StarButton
          itemId={item.id}
          starred={item.metadata?.starred === true}
          size="sm"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </Link>
    );
  }

  // --- STANDARD ROW ---
  return (
    <Link
      href={`/item/${item.id}`}
      prefetch={true}
      className={cn(
        'group flex min-w-0 flex-1 items-center gap-3 border-b border-border px-4 py-2 transition-colors duration-100 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive && 'bg-accent/50',
      )}
      style={{
        height: '64px',
        borderLeftWidth: '4px',
        borderLeftColor: `var(--domain-${colourKey}-text)`,
      }}
    >
      <ThumbnailSmall
        src={item.thumbnail_url}
        alt={title}
        contentType={item.content_type}
        domain={item.primary_domain}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={item.priority} />
          <span
            className={cn(
              'truncate text-sm text-foreground',
              isRead === false ? 'font-semibold' : 'font-normal',
            )}
          >
            {renderText(title)}
          </span>
          <DomainBadge
            domain={item.primary_domain ?? ''}
            className="shrink-0"
          />
          {isFeatureEnabled('content_layers') && !!item.metadata?.layer && (
            <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 border-confidence-needs-sme-border text-confidence-needs-sme">
              {getLayerLabel(item.metadata.layer as string)}
            </Badge>
          )}
          {isSearchResult(item) && (
            <SimilarityBadge score={item.similarity} className="shrink-0" />
          )}
          {item.freshness && item.freshness !== 'fresh' && (
            <FreshnessBadge freshness={item.freshness} compact className="shrink-0" />
          )}
          {hasQualityFlag && (
            <AlertTriangle
              className="size-3 shrink-0 text-quality-severity-warning"
              aria-label="Has quality issues"
            />
          )}
        </div>
        <span
          className={cn(
            'truncate text-xs',
            isRead ? 'text-muted-foreground/60' : 'text-muted-foreground',
          )}
        >
          {isSearchResult(item) && item.snippet ? (
            renderText(`\u2026${item.snippet}\u2026`)
          ) : item.brief || item.ai_summary ? (
            renderText(item.brief || item.ai_summary || '')
          ) : (
            <span className="flex items-center gap-1">
              <ContentTypeIcon contentType={item.content_type} size="size-3" />
              {[
                formatContentType(item.content_type),
                item.platform,
                item.author_name,
              ]
                .filter(Boolean)
                .reduce<React.ReactNode[]>((acc, part, i) => {
                  if (i > 0) acc.push(<span key={`sep-${i}`} aria-hidden="true"> &middot; </span>);
                  acc.push(<span key={i}>{part}</span>);
                  return acc;
                }, [])}
            </span>
          )}
        </span>
      </div>
      <time
        className={cn(
          'shrink-0 text-xs',
          isRead ? 'text-muted-foreground/60' : 'text-muted-foreground',
        )}
        dateTime={item.captured_date ?? undefined}
      >
        {formatDate(item.captured_date)}
      </time>
      {activeWorkspaces && assignedWorkspaceIds && (
        <QuickAssignButton
          itemId={item.id}
          activeWorkspaces={activeWorkspaces}
          assignedWorkspaceIds={assignedWorkspaceIds}
          onAssignmentChange={onAssignmentChange}
          className="shrink-0"
        />
      )}
      {canEdit && (
        <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100">
          <QuickReviewActions
            itemId={item.id}
            itemTitle={getDisplayTitle(item)}
            verifiedAt={item.verified_at}
            hasQualityFlag={hasQualityFlag}
            onOptimisticUpdate={onQuickReviewUpdate}
            canEdit={canEdit}
          />
        </span>
      )}
      <StarButton
        itemId={item.id}
        starred={item.metadata?.starred === true}
        size="sm"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      />
    </Link>
  );
});
