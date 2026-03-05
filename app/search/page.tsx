'use client';

import { Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { LayoutGrid, List, RefreshCw, SearchX, Info } from 'lucide-react';
import { SearchBar } from '@/components/search-bar';
import { Thumbnail } from '@/components/thumbnail';
import { DomainBadge } from '@/components/domain-badge';
import { SimilarityBadge } from '@/components/similarity-badge';
import { ContentTypeIcon } from '@/components/content-type-icon';
import { StarButton } from '@/components/star-button';
import { PriorityBadge } from '@/components/priority-selector';
import { VerificationBadge } from '@/components/verification-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch } from '@/hooks/use-search';
import { useReadMarks } from '@/contexts/read-marks-context';
import { getDisplayTitle, formatDate, formatContentType } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@/types/content';

type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'kb-search-view-mode';

function getStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Skeleton placeholder for grid view while results load */
function GridSkeleton() {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-lg border border-border"
        >
          <Skeleton className="aspect-video w-full rounded-b-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="mt-auto flex flex-col gap-1.5 pt-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton placeholder for list view while results load */
function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
          style={{ height: '64px' }}
        >
          <Skeleton className="size-10 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Highlight matching query terms in text by wrapping them in <mark> elements.
 * Returns an array of React nodes (strings and JSX elements).
 */
function highlightTerms(text: string, query: string): ReactNode[] {
  if (!query.trim()) return [text];

  // Split query into unique words (min 2 chars to avoid highlighting noise)
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return [text];

  // Use a capturing group so split keeps the matched delimiters
  const pattern = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(pattern);

  // A non-global regex to test whether a part is a matched term
  const testPattern = new RegExp(`^(?:${terms.join('|')})$`, 'i');

  return parts.map((part, i) => {
    if (testPattern.test(part)) {
      return (
        <mark
          key={i}
          className="bg-highlight-mark px-0.5 rounded text-foreground"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

/** Search result card with query term highlighting on title and summary.
 *  Q&A pair items show answer preview instead of ai_summary, plus source document. */
function HighlightedSearchCard({
  item,
  query,
  isRead,
}: {
  item: SearchResult;
  query: string;
  isRead?: boolean;
}) {
  const title = getDisplayTitle(item);
  const isQAPair = item.content_type === 'q_a_pair';

  // For Q&A pairs, show the answer content (from ai_summary) as preview
  const previewText = isQAPair
    ? (item.ai_summary ?? null)
    : (item.ai_summary ?? null);

  return (
    <Link
      href={`/item/${item.id}`}
      prefetch={true}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-150 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isRead && 'opacity-75',
      )}
    >
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
              className="size-2 rounded-full bg-primary shadow-sm"
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
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="flex items-start gap-1.5 text-sm font-medium leading-snug text-foreground">
          <PriorityBadge priority={item.priority} />
          <span className="line-clamp-2">{highlightTerms(title, query)}</span>
        </h3>
        <SimilarityBadge score={item.similarity} />
        {previewText && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {isQAPair && (
              <span className="mr-1 font-medium text-foreground/70">A:</span>
            )}
            {highlightTerms(previewText, query)}
          </p>
        )}
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <DomainBadge domain={item.primary_domain ?? ''} />
            {item.verified_at && (
              <VerificationBadge verified={true} size="sm" />
            )}
          </div>
          {isQAPair && item.source_document && (
            <span className="truncate text-xs text-muted-foreground">
              Source: {item.source_document}
            </span>
          )}
          {item.author_name && (
            <span className="truncate text-xs font-medium text-foreground">
              {item.author_name}
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ContentTypeIcon contentType={item.content_type} size="size-3" />
            {[formatContentType(item.content_type), item.platform]
              .filter(Boolean)
              .join(' \u00B7 ')}
          </span>
          <time
            className="text-xs text-muted-foreground"
            dateTime={item.captured_date ?? undefined}
          >
            {formatDate(item.captured_date)}
          </time>
        </div>
      </div>
    </Link>
  );
}

/** Grid of search result cards with query term highlighting */
function HighlightedGrid({
  items,
  query,
  readItemIds,
}: {
  items: SearchResult[];
  query: string;
  readItemIds?: Set<string>;
}) {
  return (
    <div
      role="feed"
      aria-label="Search results"
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          role="article"
          aria-setsize={items.length}
          aria-posinset={i + 1}
        >
          <HighlightedSearchCard
            item={item}
            query={query}
            isRead={readItemIds ? readItemIds.has(item.id) : undefined}
          />
        </div>
      ))}
    </div>
  );
}

/** List of search results with query term highlighting */
function HighlightedList({
  items,
  query,
  readItemIds,
}: {
  items: SearchResult[];
  query: string;
  readItemIds?: Set<string>;
}) {
  return (
    <div
      role="feed"
      aria-label="Search results"
      className="rounded-lg border border-border"
    >
      {items.map((item, i) => {
        const title = getDisplayTitle(item);
        const isRead = readItemIds ? readItemIds.has(item.id) : undefined;
        return (
          <Link
            key={item.id}
            href={`/item/${item.id}`}
            prefetch={true}
            role="article"
            aria-setsize={items.length}
            aria-posinset={i + 1}
            className={cn(
              'flex items-center gap-3 border-b border-border px-4 py-2 transition-colors last:border-b-0 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              isRead && 'opacity-75',
            )}
          >
            <Thumbnail
              src={item.thumbnail_url}
              alt={title}
              contentType={item.content_type}
              domain={item.primary_domain}
              className="size-10 shrink-0 rounded"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {highlightTerms(title, query)}
                </span>
                <DomainBadge domain={item.primary_domain ?? ''} />
              </div>
              {item.ai_summary && (
                <p className="truncate text-xs text-muted-foreground">
                  {highlightTerms(item.ai_summary, query)}
                </p>
              )}
            </div>
            <time
              className="shrink-0 text-xs text-muted-foreground"
              dateTime={item.captured_date ?? undefined}
            >
              {formatDate(item.captured_date)}
            </time>
          </Link>
        );
      })}
    </div>
  );
}

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { results, count, isLoading, error, search } = useSearch();
  const { readItemIds, isLoaded: readMarksLoaded, loadReadMarks, checkReadStatus } = useReadMarks();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // Check read status for search results when they change
  useEffect(() => {
    if (results.length > 0) {
      checkReadStatus(results.map((r) => r.id));
    }
  }, [results, checkReadStatus]);

  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Initialise view mode from localStorage after mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrating client-only localStorage value after mount to avoid SSR mismatch
    setViewMode(getStoredViewMode());
  }, []);

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  // Trigger search when query changes
  useEffect(() => {
    if (query) {
      search(query);
    }
  }, [query, search]);

  const handleRetry = useCallback(() => {
    if (query) {
      search(query);
    }
  }, [query, search]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="sr-only">
        {query ? `Search results for \u201c${query}\u201d` : 'Search'}
      </h1>

      {/* Search bar (compact, pre-filled with query) */}
      <div className="mb-8">
        <SearchBar variant="compact" defaultValue={query} autoFocus />
      </div>

      {/* Error state */}
      {error && !isLoading && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="flex-1 text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="shrink-0"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div role="status" aria-label="Loading search results" aria-busy="true">
          <div className="mb-6 flex items-center justify-between">
            <Skeleton className="h-5 w-48" />
            <div className="flex items-center gap-1">
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          </div>
          {viewMode === 'grid' ? <GridSkeleton /> : <ListSkeleton />}
        </div>
      )}

      {/* Results */}
      {!isLoading && !error && query && (
        <>
          {/* Results header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
                {count > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{count}</span>{' '}
                    {count === 1 ? 'result' : 'results'} for{' '}
                    <span className="font-medium text-foreground">
                      &lsquo;{query}&rsquo;
                    </span>
                  </>
                ) : null}
              </p>
              {count > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Hybrid search
                      <Info className="size-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    Results ranked by a combination of AI embedding similarity
                    and keyword matching for title, author, and keywords.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {count > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => handleViewChange('grid')}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => handleViewChange('list')}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <List className="size-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          {count === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <SearchX className="mx-auto mb-4 size-12 text-muted-foreground/50" />
              <h2 className="mb-2 text-lg font-medium text-foreground">
                No matches found for &lsquo;{query}&rsquo;
              </h2>
              <p className="mb-6 max-w-md text-sm text-muted-foreground mx-auto text-center">
                Try broader terms, different keywords, or browse by domain to
                explore your collection.
              </p>
              <Button variant="outline" asChild>
                <Link href="/browse">Browse by domain</Link>
              </Button>
            </div>
          )}

          {/* Result items — highlighted when query is present */}
          {count > 0 &&
            (viewMode === 'grid' ? (
              <HighlightedGrid
                items={results}
                query={query}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
              />
            ) : (
              <HighlightedList
                items={results}
                query={query}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
              />
            ))}
        </>
      )}

      {/* No query state (navigated to /search without ?q=) */}
      {!isLoading && !error && !query && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Enter a query in the search bar above to find semantically similar
            items in your collection.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Skeleton className="mb-8 h-9 w-full max-w-sm" />
          <Skeleton className="mb-6 h-5 w-48" />
          <GridSkeleton />
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
