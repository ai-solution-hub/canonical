'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Tags, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getDisplayTitle } from '@/lib/format';
import { DomainBadge } from '@/components/domain-badge';

interface RelatedItem {
  id: string;
  title: string | null;
  suggested_title: string | null;
  primary_domain: string | null;
  content_type: string | null;
  overlap_count: number;
}

interface RelatedByTagsProps {
  /** Current item ID (excluded from results) */
  itemId: string;
  /** Tags to match against */
  tags: string[];
  /** Maximum items to show */
  limit?: number;
}

/**
 * Panel showing up to N items that share the most tags with the current item.
 * Fetches on mount using a client-side Supabase query.
 */
export function RelatedByTags({
  itemId,
  tags,
  limit = 5,
}: RelatedByTagsProps) {
  const [items, setItems] = useState<RelatedItem[]>([]);
  const [loading, setLoading] = useState(tags.length > 0);

  useEffect(() => {
    if (!tags.length) {
      return;
    }

    const fetchRelated = async () => {
      const supabase = createClient();

      // Find items that overlap on user_tags, excluding current item
      const { data, error } = await supabase
        .from('content_items')
        .select('id, title, suggested_title, primary_domain, content_type, user_tags')
        .neq('id', itemId)
        .overlaps('user_tags', tags)
        .or('governance_review_status.is.null,governance_review_status.neq.draft')
        .limit(50); // Fetch more than needed to sort by overlap

      if (error || !data) {
        setLoading(false);
        return;
      }

      // Calculate overlap count and sort
      const scored = data
        .map((item) => {
          const itemTags = (item.user_tags as string[]) ?? [];
          const overlapCount = tags.filter((t) => itemTags.includes(t)).length;
          return {
            id: item.id as string,
            title: item.title as string | null,
            suggested_title: item.suggested_title as string | null,
            primary_domain: item.primary_domain as string | null,
            content_type: item.content_type as string | null,
            overlap_count: overlapCount,
          };
        })
        .sort((a, b) => b.overlap_count - a.overlap_count)
        .slice(0, limit);

      setItems(scored);
      setLoading(false);
    };

    fetchRelated();
  }, [itemId, tags, limit]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Finding related items…
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Tags className="size-4" />
        Related by Tags
      </h3>
      <ul className="space-y-2">
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
                    {item.overlap_count} shared tag{item.overlap_count !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
