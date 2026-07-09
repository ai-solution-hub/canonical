'use client';

import Link from 'next/link';
import { CircleHelp, Loader2 } from 'lucide-react';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';
import {
  useDerivedPairs,
  type DerivedPair,
} from '@/hooks/source-document-detail/use-source-document-detail';

/**
 * DerivedPairsList — lists published `q_a_pairs` derived from this
 * `source_document` (ID-135 {135.17}, TECH.md §3 BI-28, §4).
 *
 * Data comes from `useDerivedPairs` ({135.13}), which reads the
 * `derived_pairs` field off the re-pointed `[id]` route (BI-29 — id-131
 * BND-1 Path β). That route filters to `q_a_pairs` where
 * `source_document_id = id` AND `publication_status = 'published'`
 * SERVER-SIDE. This component renders exactly what the hook returns and
 * adds NO client-side publication filter — `pairs` below is a direct
 * passthrough of `data`, never `.filter()`'d. Unpublished/superseded pairs
 * are therefore structurally excluded upstream (route + hook), never here;
 * see `__tests__/hooks/source-document-detail/use-source-document-detail.test.tsx`
 * ("surfaces only published pairs as returned by the route") for the
 * server-side enforcement proof.
 *
 * Each entry links to `/library` (single-pair read target) — plain
 * `/library`, no query param — matching the `answer`-kind destination
 * convention `CorpusResultCard` established ({135.7}), pending the id-71
 * q_a_pair-viewer rebind (see that component's `destinationHref` comment).
 *
 * BI-30 (independent per-section queries): this is its own TanStack query
 * (`useDerivedPairs`) with its own loading/error/retry UI — a failure here
 * never fails the rest of the Surface-B detail page. The error/retry chrome
 * is the shared `SectionErrorState` ({135.18} convergence pass, previously a
 * bespoke inline block here — the visible copy is preserved, only the
 * markup converges).
 *
 * No published answers → a clear empty state (BI-28), never an error.
 */

/** Stable empty default (components/CLAUDE.md — never hand a fresh `[]`). */
const EMPTY_PAIRS: DerivedPair[] = [];

export interface DerivedPairsListProps {
  documentId: string;
}

export function DerivedPairsList({ documentId }: DerivedPairsListProps) {
  const { data, isLoading, isError, refetch } = useDerivedPairs(documentId);
  const pairs = data ?? EMPTY_PAIRS;

  return (
    <section
      aria-label="Derived answers"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-medium text-foreground">Derived answers</h2>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        </div>
      ) : isError ? (
        <SectionErrorState
          heading="Couldn't load the derived answers"
          message="Something went wrong while loading the derived answers. This is usually temporary."
          retryLabel="Retry"
          onRetry={() => refetch()}
        />
      ) : pairs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CircleHelp
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            No published answers have been derived from this document yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pairs.map((pair) => (
            <li key={pair.id}>
              <Link
                href="/library"
                prefetch={false}
                className="group flex items-start gap-2 rounded-md border border-border p-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <CircleHelp
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="line-clamp-2 text-foreground">
                  {pair.question_text}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
