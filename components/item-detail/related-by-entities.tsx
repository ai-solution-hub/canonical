'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Network, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { DomainBadge } from '@/components/shared/domain-badge';

interface RelatedItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  content_type: string | null;
  shared_entity_count: number;
  shared_entities: string[];
}

interface RelatedByEntitiesProps {
  /** Current item ID (excluded from results) */
  contentItemId: string;
  /** Maximum items to show */
  limit?: number;
  className?: string;
}

/**
 * Shows up to N content items that share the most entities with the current item.
 * Only renders if the current item has entities AND there are related items.
 * Fetches on mount using client-side Supabase queries.
 */
export function RelatedByEntities({
  contentItemId,
  limit = 5,
  className,
}: RelatedByEntitiesProps) {
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRelated = async () => {
      const supabase = createClient();

      // Step 1: Get entities for this item
      const { data: myEntities, error: entError } = await supabase
        .from('entity_mentions')
        .select('canonical_name')
        .eq('content_item_id', contentItemId);

      if (entError) {
        console.error('RelatedByEntities: failed to fetch entities for item:', entError);
      }
      if (entError || !myEntities || myEntities.length === 0) {
        setLoading(false);
        return;
      }

      // Deduplicate canonical names
      const myEntityNames = [
        ...new Set(myEntities.map((e) => e.canonical_name)),
      ];

      // Step 2: Find other items that share these entities
      const { data: sharedMentions, error: sharedError } = await supabase
        .from('entity_mentions')
        .select('content_item_id, canonical_name')
        .in('canonical_name', myEntityNames)
        .neq('content_item_id', contentItemId);

      if (sharedError) {
        console.error('RelatedByEntities: failed to fetch shared entity mentions:', sharedError);
      }
      if (sharedError || !sharedMentions || sharedMentions.length === 0) {
        setLoading(false);
        return;
      }

      // Group by content_item_id and count shared entities
      const itemMap = new Map<
        string,
        { count: number; entities: Set<string> }
      >();
      for (const mention of sharedMentions) {
        const existing = itemMap.get(mention.content_item_id);
        if (existing) {
          existing.entities.add(mention.canonical_name);
          existing.count = existing.entities.size;
        } else {
          itemMap.set(mention.content_item_id, {
            count: 1,
            entities: new Set([mention.canonical_name]),
          });
        }
      }

      // Sort by shared entity count and take top N
      const topItems = [...itemMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit);

      if (topItems.length === 0) {
        setLoading(false);
        return;
      }

      // Step 3: Fetch content item details
      const ids = topItems.map(([id]) => id);
      const { data: details, error: detailError } = await supabase
        .from('content_items')
        .select(
          'id, title, suggested_title, primary_domain, content_type',
        )
        .in('id', ids)
        .or(
          'governance_review_status.is.null,governance_review_status.neq.draft',
        );

      if (detailError) {
        console.error('RelatedByEntities: failed to fetch content item details:', detailError);
      }
      if (detailError || !details) {
        setLoading(false);
        return;
      }

      // Merge details with shared entity counts
      const result: RelatedItem[] = topItems
        .map(([id, { count, entities }]) => {
          const detail = details.find((d) => d.id === id);
          if (!detail) return null;
          return {
            id: detail.id as string,
            title: detail.title as string | null,
            suggested_title: detail.suggested_title as string | null,
            primary_domain: detail.primary_domain as string | null,
            content_type: detail.content_type as string | null,
            shared_entity_count: count,
            shared_entities: [...entities],
          };
        })
        .filter((item): item is RelatedItem => item !== null);

      setItems(result);
      setLoading(false);
    };

    fetchRelated();
  }, [contentItemId, limit]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Finding related content by entities…
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Network className="size-4" aria-hidden="true" />
        Related by Shared Entities
      </h3>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/item/${item.id}`}
              className="group flex items-start gap-2 rounded-md p-2 -mx-2 transition-colors hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                  {getDisplayTitle(item)}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  {item.primary_domain && (
                    <DomainBadge domain={item.primary_domain} />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.shared_entity_count} shared entit{item.shared_entity_count !== 1 ? 'ies' : 'y'}
                  </span>
                </div>
                {item.shared_entities.length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {item.shared_entities.slice(0, 3).join(', ')}
                    {item.shared_entities.length > 3 && ` +${item.shared_entities.length - 3} more`}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
