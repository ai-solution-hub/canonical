'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchPublicationReviewQueue } from '@/lib/query/fetchers';
import { PublicationReviewCard } from '@/components/review/publication-review-card';
import { PublicationReviewActionBar } from '@/components/review/publication-review-action-bar';
import type { ReviewQueueItem } from '@/types/review';

/**
 * Tab 6 of /review — "Awaiting publication" queue.
 *
 * Calls `GET /api/review/queue?publication_status=in_review` via TanStack
 * Query (per CLAUDE.md "Data fetching: TanStack Query exclusively"). Each
 * row renders as `<PublicationReviewCard>` paired with a
 * `<PublicationReviewActionBar>` (NOT folded into the card so the action
 * set stays swappable per spec §7).
 *
 * Empty-state copy is fixed by spec §7 to: "No items awaiting publication.
 * EP2 markdown ingests + bulk approval (§5.3) feed this queue."
 *
 * Stable empty default (CLAUDE.md G14): `EMPTY_ITEMS` is a module-level
 * const so the `useMemo` pulling items off the response keeps a stable
 * identity when the response is null/undefined.
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (f).
 */

const EMPTY_ITEMS: ReviewQueueItem[] = [];

export function PublicationReviewQueue() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.review.publicationReviewQueue(),
    queryFn: () => fetchPublicationReviewQueue(),
  });

  const items = useMemo<ReviewQueueItem[]>(
    () => data?.items ?? EMPTY_ITEMS,
    [data?.items],
  );

  // Loading skeleton — mirrors the standard review-queue skeleton shape so
  // tab switches don't visually jolt.
  if (isLoading) {
    return (
      <section
        aria-label="Awaiting publication — loading"
        className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
      >
        <div role="status" aria-label="Loading awaiting-publication queue">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mb-4 rounded-xl border border-border bg-card p-5"
            >
              <div className="h-5 w-32 animate-pulse rounded-full bg-accent" />
              <div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-accent" />
              <div className="mt-4 space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-accent" />
                <div className="h-4 w-full animate-pulse rounded bg-accent" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-accent" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        aria-label="Awaiting publication — error"
        className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
      >
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <p className="font-medium">Failed to load awaiting-publication queue.</p>
          <p className="mt-1 text-xs">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section
        aria-label="Awaiting publication — empty"
        className="mx-auto w-full max-w-[800px] px-4 py-12 sm:px-6"
      >
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
          <ClipboardList
            className="size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold">
            No items awaiting publication.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            EP2 markdown ingests + bulk approval (§5.3) feed this queue.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={`Awaiting publication — ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
    >
      <ul className="flex flex-col gap-4" role="list">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-card">
            <PublicationReviewCard item={item} className="border-0 shadow-none" />
            <PublicationReviewActionBar itemId={item.id} />
          </li>
        ))}
      </ul>
    </section>
  );
}
