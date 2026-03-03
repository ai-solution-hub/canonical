'use client';

import { ContentCard } from '@/components/content-card';
import type { ContentListItem } from '@/types/content';

interface RelatedItemsProps {
  relatedItems: Array<ContentListItem & { similarity: number }>;
}

export function RelatedItems({ relatedItems }: RelatedItemsProps) {
  if (relatedItems.length === 0) {
    return null;
  }

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Related Content
      </h2>
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
    </section>
  );
}
