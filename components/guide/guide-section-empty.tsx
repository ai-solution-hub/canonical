'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';

interface GuideSectionEmptyProps {
  domainFilter: string | null;
  subtopicFilter: string | null;
  expectedLayer: string | null;
}

export function GuideSectionEmpty({
  domainFilter,
  subtopicFilter,
  expectedLayer,
}: GuideSectionEmptyProps) {
  // Build pre-filled create link
  const params = new URLSearchParams();
  if (domainFilter) params.set('domain', domainFilter);
  if (subtopicFilter) params.set('subtopic', subtopicFilter);
  if (expectedLayer) params.set('layer', expectedLayer);
  const createHref = `/item/new${params.toString() ? `?${params.toString()}` : ''}`;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
      <p className="text-xs text-muted-foreground">No content yet</p>
      <Link
        href={createHref}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3" aria-hidden="true" />
        Create content
      </Link>
    </div>
  );
}
