'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAdminNearDupPairs, type NearDupPair } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { NearDuplicatesEmptyState } from './near-duplicates-empty-state';
import { NearDuplicatesFilterBar } from './near-duplicates-filter-bar';

const SKELETON_ROWS = 5;
const DEFAULT_THRESHOLD = 0.95;
// Stable empty-array reference — prevents downstream useMemo deps from
// invalidating every render (CLAUDE.md "stable empty array/object defaults"
// gotcha).
const EMPTY_PAIRS: NearDupPair[] = [];
const EMPTY_DOMAINS: string[] = [];

/**
 * §1.9 near-duplicate dashboard list view.
 *
 * Renders the filter bar (threshold slider + domain Select), a similarity-
 * sorted table of candidate pairs, the empty state, loading skeleton, and
 * an error panel with retry.
 *
 * The threshold slider committed value drives the TanStack Query cache key
 * — a debounced `onThresholdCommit` (300ms inside the filter bar) avoids
 * thrashing the network while the admin drags.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.1.
 */
export function NearDuplicatesPairListClient() {
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  const [domain, setDomain] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: queryKeys.adminNearDup.pairs(threshold, domain),
    queryFn: () => fetchAdminNearDupPairs({ threshold, domain }),
  });

  // Destructure nested data before useMemo so the React Compiler's
  // inferred dependency tracks the source list (CLAUDE.md "destructure
  // nested properties" gotcha).
  const pairs = query.data?.pairs;
  const total = query.data?.total ?? 0;

  const stablePairs = useMemo(() => pairs ?? EMPTY_PAIRS, [pairs]);

  const availableDomains = useMemo(() => {
    if (!pairs) return EMPTY_DOMAINS;
    const domains = new Set<string>();
    for (const pair of pairs) {
      if (pair.left.primaryDomain) domains.add(pair.left.primaryDomain);
      if (pair.right.primaryDomain) domains.add(pair.right.primaryDomain);
    }
    return [...domains].sort();
  }, [pairs]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/content-dedup" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to exact-hash queue
          </Link>
        </Button>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-foreground">
          Near-Duplicate Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review embedding-similarity pairs that exact-hash dedup misses. Merge
          by supersession, confirm both unique, or defer for later.
        </p>
      </header>

      <NearDuplicatesFilterBar
        threshold={threshold}
        domain={domain}
        totalCount={total}
        availableDomains={availableDomains}
        onThresholdCommit={setThreshold}
        onDomainChange={setDomain}
      />

      {query.isLoading ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            {Array.from({ length: SKELETON_ROWS }).map((_, idx) => (
              <Skeleton key={idx} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card role="alert" className="border-status-error/30 bg-status-error/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-status-error">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Failed to load near-duplicate pairs
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching near-duplicate pairs.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="near-dup-list-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : stablePairs.length === 0 ? (
        <NearDuplicatesEmptyState threshold={threshold} />
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">
              {stablePairs.length} candidate pair
              {stablePairs.length === 1 ? '' : 's'} &ge; {threshold.toFixed(2)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              aria-label="Near-duplicate candidate pairs"
            >
              <caption className="sr-only">
                Near-duplicate candidate pairs above the chosen similarity
                threshold.
              </caption>
              <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 w-32">
                    Similarity
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Pair
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {stablePairs.map((pair) => (
                  <PairRow key={pair.pairId} pair={pair} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {query.isFetching && !query.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Refreshing…
        </p>
      ) : null}
    </div>
  );
}

interface PairRowProps {
  pair: NearDupPair;
}

/**
 * Single table row for a near-duplicate pair.
 *
 * Similarity is shown both as a numeric label and as a width-proportional
 * bar — WCAG: never colour alone, the bar uses semantic
 * `bg-status-success` (high) / `bg-status-warning` (mid) classes but the
 * numeric label always carries the same information.
 */
function PairRow({ pair }: PairRowProps) {
  const similarityPct = Math.round(pair.similarity * 100);
  const tier =
    pair.similarity >= 0.97
      ? 'bg-status-error'
      : pair.similarity >= 0.93
        ? 'bg-status-warning'
        : 'bg-status-info';

  return (
    <tr
      className="border-b last:border-b-0 hover:bg-muted/40"
      data-testid={`near-dup-pair-row-${pair.pairId}`}
    >
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs tabular-nums text-foreground">
            {pair.similarity.toFixed(3)}
          </span>
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            role="presentation"
          >
            <div
              className={`h-full ${tier}`}
              style={{ width: `${similarityPct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="line-clamp-1 font-medium text-foreground">
            {pair.left.title?.trim() ? pair.left.title : 'Untitled'}
          </span>
          <span
            className="line-clamp-1 text-xs text-muted-foreground"
            aria-label="paired with"
          >
            ↔ {pair.right.title?.trim() ? pair.right.title : 'Untitled'}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {pair.left.primaryDomain ? (
              <Badge variant="outline" className="text-xs">
                {pair.left.primaryDomain}
              </Badge>
            ) : null}
            {pair.left.contentType ? (
              <Badge variant="secondary" className="text-xs">
                {pair.left.contentType}
              </Badge>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <Button
          asChild
          variant="outline"
          size="sm"
          data-testid={`near-dup-pair-resolve-${pair.pairId}`}
        >
          <Link href={`/admin/content-dedup/near-duplicates/${pair.pairId}`}>
            Resolve
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </td>
    </tr>
  );
}
