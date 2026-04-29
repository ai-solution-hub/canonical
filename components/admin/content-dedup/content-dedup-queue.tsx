'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Loader2 } from 'lucide-react';
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
import { formatDateUK } from '@/lib/format';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchAdminDedupQueue,
  type DedupQueueFilters,
} from '@/lib/query/fetchers';
import { ContentDedupEmptyState } from './content-dedup-empty-state';
import { ContentDedupFilterBar } from './content-dedup-filter-bar';

const SKELETON_ROWS = 5;
const EMPTY_DOMAINS: string[] = [];

/**
 * Top-level admin dedup queue (list view) at `/admin/content-dedup`.
 *
 * Renders the filter bar, a table of suspected_duplicate rows, and the
 * empty state when the queue is clear. Each row links to the detail
 * route `/admin/content-dedup/[id]`.
 *
 * Spec: `docs/specs/§1.7-admin-dedup-review-spec.md` §6.1.
 */
export function ContentDedupQueueClient() {
  const [filters, setFilters] = useState<DedupQueueFilters>({
    sort: 'created_at_desc',
  });

  const query = useQuery({
    queryKey: queryKeys.adminDedup.queue(
      filters as unknown as Record<string, unknown>,
    ),
    queryFn: () => fetchAdminDedupQueue(filters),
  });

  // Destructure nested data before useMemo so the React Compiler's
  // inferred dependency matches the source-list (CLAUDE.md gotcha:
  // "Destructure nested properties before using in `useCallback` deps").
  const items = query.data?.items;
  const availableDomains = useMemo(() => {
    if (!items) return EMPTY_DOMAINS;
    const domains = new Set<string>();
    for (const row of items) {
      if (row.primary_domain) domains.add(row.primary_domain);
    }
    return [...domains].sort();
  }, [items]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">
          Cross-System Dedup Review
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review suspected-duplicate content rows soft-blocked at ingest.
          Confirm duplicate, confirm unique, or mark superseded.
        </p>
      </header>

      <ContentDedupFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={() => query.refetch()}
        availableDomains={availableDomains}
        isRefreshing={query.isFetching}
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
              Failed to load dedup queue
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching the dedup queue.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="dedup-queue-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : !query.data || query.data.items.length === 0 ? (
        <ContentDedupEmptyState />
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">
              {query.data.items.length} row
              {query.data.items.length === 1 ? '' : 's'} pending review
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              aria-label="Suspected duplicate content rows"
            >
              <caption className="sr-only">
                Suspected duplicate content rows pending admin review.
              </caption>
              <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Created
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Domain
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Source
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b last:border-b-0 hover:bg-muted/40"
                    data-testid={`dedup-row-${row.id}`}
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                      {formatDateUK(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="line-clamp-1 font-medium text-foreground">
                        {row.title?.trim() ? row.title : 'Untitled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <Badge variant="outline">
                        {row.primary_domain ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {row.ingest_source ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        data-testid={`dedup-row-resolve-${row.id}`}
                      >
                        <Link href={`/admin/content-dedup/${row.id}`}>
                          Resolve
                          <ChevronRight
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        </Link>
                      </Button>
                    </td>
                  </tr>
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
