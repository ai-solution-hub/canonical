'use client';

import Link from 'next/link';
import { BookOpen, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

// Matches the /api/guides GET projection (GuideRowSchema) — only the fields
// the listing renders are typed here.
interface GuideListRow {
  id: string;
  slug: string;
  name: string;
  guide_type: string;
  description?: string | null;
}

/**
 * /guide listing — the DR-126 first-class guides surface. Rebuilt S531:
 * the previous page permanentRedirect'ed to /coverage?tab=guides, whose
 * guides tab was retired by DR-034 and whose page died in the id-417
 * third wave, leaving a live nav path 404ing. Detail pages
 * (/guide/[slug]) were never affected.
 */
export function GuideListContent() {
  const {
    data: guides,
    isLoading,
    isError,
  } = useQuery<GuideListRow[]>({
    queryKey: queryKeys.guides.list,
    queryFn: () => fetchJson<GuideListRow[]>('/api/guides'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center py-16"
        role="status"
        aria-label="Loading guides"
      >
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <span className="sr-only">Loading guides...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        Failed to load guides. Try refreshing the page.
      </div>
    );
  }

  if (!guides || guides.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <BookOpen
          className="size-10 text-muted-foreground/50"
          aria-hidden="true"
        />
        <h2 className="mt-4 text-base font-medium text-foreground">
          No guides yet
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Guides are created in Settings once there is content to organise.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
      {guides.map((guide) => (
        <li key={guide.id}>
          <Link
            href={`/guide/${encodeURIComponent(guide.slug)}`}
            className="flex h-full flex-col rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BookOpen
                className="size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              {guide.name}
            </span>
            {guide.description && (
              <span className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                {guide.description}
              </span>
            )}
            <span className="mt-auto pt-3 text-xs capitalize text-muted-foreground">
              {guide.guide_type.replaceAll('_', ' ')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
