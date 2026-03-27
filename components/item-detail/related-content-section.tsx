'use client';

import { useState, useEffect, useRef } from 'react';
import { ContentCard } from '@/components/content/content-card';
import { RelatedByTags } from '@/components/item-detail/related-by-tags';
import { RelatedByEntities } from '@/components/item-detail/related-by-entities';

import type { ContentListItem } from '@/types/content';

export interface RelatedContentSectionProps {
  relatedItems: Array<ContentListItem & { similarity: number }>;
  itemId: string;
  userTags: string[];
}

/**
 * Consolidated related content section.
 * Wraps Similar Items, RelatedByTags, and RelatedByEntities into a single
 * "Related Content" section with sub-headings. Only renders the outer
 * section when at least one sub-section has visible content.
 *
 * Similar Items are rendered inline (not via RelatedItems component) to avoid
 * its own section wrapper. RelatedByTags and RelatedByEntities retain their
 * own internal headings which serve as the sub-headings.
 */
export function RelatedContentSection({
  relatedItems,
  itemId,
  userTags,
}: RelatedContentSectionProps) {
  const entitiesRef = useRef<HTMLDivElement>(null);
  const [hasEntities, setHasEntities] = useState<boolean | null>(null);

  const hasRelatedItems = relatedItems.length > 0;
  const hasTags = userTags.length > 0;

  // RelatedByEntities fetches async and returns null when empty.
  // Observe its container to detect whether it rendered visible content.
  useEffect(() => {
    const container = entitiesRef.current;
    if (!container) return;

    const checkContent = () => {
      // RelatedByEntities renders a <div> with an <h3> and <ul> when it has
      // results, or null when empty. A loading spinner is also a child element.
      // We consider it "has content" if there's any child element at all
      // (loading or results), and "empty" only when it has none.
      const childCount = container.childElementCount;
      setHasEntities(childCount > 0);
    };

    const observer = new MutationObserver(checkContent);
    observer.observe(container, { childList: true, subtree: true });

    // Initial check after a micro-task to let React render
    queueMicrotask(checkContent);

    return () => observer.disconnect();
  }, [itemId]);

  // Show the section if any synchronous content exists, or if entities loaded
  const hasAnyContent = hasRelatedItems || hasTags || hasEntities === true;
  // Still loading entities — don't hide the section yet
  const isEntitiesLoading = hasEntities === null;
  const showSection = hasAnyContent || isEntitiesLoading;

  if (!showSection) {
    return null;
  }

  return (
    <section
      className="mt-12 border-t border-border pt-8"
      aria-label="Related content"
    >
      <h2 className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Related Content
      </h2>
      <div className="space-y-8">
        {/* Similar items (by embedding similarity) */}
        {hasRelatedItems && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Similar Items
            </h3>
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              }}
            >
              {relatedItems.map((related) => (
                <ContentCard
                  key={related.id as string}
                  item={related}
                />
              ))}
            </div>
          </div>
        )}

        {/* Shared tags — RelatedByTags renders its own heading */}
        {hasTags && (
          <div>
            <RelatedByTags
              itemId={itemId}
              tags={userTags}
            />
          </div>
        )}

        {/* Shared entities — RelatedByEntities renders its own heading */}
        <div ref={entitiesRef}>
          <RelatedByEntities
            contentItemId={itemId}
          />
        </div>
      </div>
    </section>
  );
}
