'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Newspaper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FreshnessBadge } from '@/components/shared/freshness-badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItem {
  content_id: string;
  content_title: string;
  content_type: string;
  content_layer: string | null;
  content_brief: string | null;
  content_freshness: string | null;
  content_verified_at: string | null;
  content_captured_date: string | null;
}

interface SearchResult {
  id: string;
  title: string;
  content_type: string;
  brief: string | null;
  freshness_status: string | null;
  captured_date: string | null;
}

interface GuideResearchFeedProps {
  sectionName: string;
  sectionDescription: string | null;
  sectionOrder: number;
  domainFilter: string | null;
  existingItems: ContentItem[];
}

// ---------------------------------------------------------------------------
// Research item card
// ---------------------------------------------------------------------------

function ResearchCard({ item }: { item: ContentItem | SearchResult }) {
  // Normalise between ContentItem and SearchResult shapes
  const id = 'content_id' in item ? item.content_id : item.id;
  const title = 'content_title' in item ? item.content_title : item.title;
  const brief = 'content_brief' in item ? item.content_brief : item.brief;
  const freshness =
    'content_freshness' in item ? item.content_freshness : item.freshness_status;
  const capturedDate =
    'content_captured_date' in item ? item.content_captured_date : item.captured_date;

  return (
    <Link
      href={`/item/${id}`}
      className="group flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-accent/30"
    >
      <Newspaper
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium text-foreground group-hover:underline line-clamp-1">
          {title}
        </h4>
        {brief && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
            {brief}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {freshness && <FreshnessBadge freshness={freshness} compact />}
          {capturedDate && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(capturedDate).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>
      <ExternalLink
        className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GuideResearchFeed({
  sectionName,
  sectionDescription,
  sectionOrder,
  domainFilter,
  existingItems,
}: GuideResearchFeedProps) {
  const [additionalItems, setAdditionalItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch additional research items if existing items are sparse
  useEffect(() => {
    if (existingItems.length >= 5 || !domainFilter) return;

    async function fetchResearch() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: domainFilter!,
          limit: '5',
        });
        const res = await fetch(`/api/search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          const results: SearchResult[] = (data.results ?? data ?? [])
            .filter(
              (r: SearchResult) =>
                // Only include research-layer or article items
                r.content_type === 'article' ||
                r.content_type === 'report',
            )
            .slice(0, 5 - existingItems.length);
          setAdditionalItems(results);
        }
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    }
    fetchResearch();
  }, [domainFilter, existingItems.length]);

  const browseHref = domainFilter
    ? `/browse?domain=${encodeURIComponent(domainFilter)}&layer=research`
    : '/browse?layer=research';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* Section header */}
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold text-foreground">
          <span className="text-muted-foreground">{sectionOrder}.</span>{' '}
          {sectionName}
        </h2>
        <Badge variant="secondary" className="text-[10px]">
          Research
        </Badge>
      </div>

      {sectionDescription && (
        <p className="mt-1 text-xs text-muted-foreground">
          {sectionDescription}
        </p>
      )}

      {/* Research items */}
      <div className="mt-3 space-y-2">
        {existingItems.map((item) => (
          <ResearchCard key={item.content_id} item={item} />
        ))}
        {additionalItems.map((item) => (
          <ResearchCard key={item.id} item={item} />
        ))}

        {loading && (
          <div className="flex items-center justify-center py-4" role="status" aria-label="Loading research">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Loading research...</span>
          </div>
        )}

        {!loading && existingItems.length === 0 && additionalItems.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">
              No research content available for this domain yet.
            </p>
          </div>
        )}
      </div>

      {/* View all link */}
      <div className="mt-3">
        <Link
          href={browseHref}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          View all research content &rarr;
        </Link>
      </div>
    </div>
  );
}
