'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchAdminNearDupPair } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { NearDuplicatesActionButtons } from './near-duplicates-action-buttons';
import { NearDuplicatesPairRowCard } from './near-duplicates-pair-row-card';

interface NearDuplicatesPairDetailClientProps {
  pairId: string;
}

/**
 * Detail-and-resolve view at
 * `/admin/content-dedup/near-duplicates/[pairId]`.
 *
 * Renders side-by-side {@link NearDuplicatesPairRowCard}s for the pair's
 * left and right rows, the similarity score in the header, and the
 * three-action {@link NearDuplicatesActionButtons} surface.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.2.
 */
export function NearDuplicatesPairDetailClient({
  pairId,
}: NearDuplicatesPairDetailClientProps) {
  const query = useQuery({
    queryKey: queryKeys.adminNearDup.pair(pairId),
    queryFn: () => fetchAdminNearDupPair(pairId),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/content-dedup/near-duplicates" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to near-duplicate list
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-sm text-muted-foreground">
              Loading near-duplicate pair…
            </span>
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card role="alert" className="border-status-error/30 bg-status-error/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-status-error">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Failed to load near-duplicate pair
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching the pair detail.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="near-dup-detail-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : !query.data ? null : (
        <>
          <header>
            <h1 className="text-xl font-semibold">
              Resolve near-duplicate pair
            </h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                Similarity: {query.data.similarity.toFixed(3)}
                {query.data.similarity >= 1 ? ' (exact)' : ''}
              </Badge>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <NearDuplicatesPairRowCard row={query.data.left} side="left" />
            <NearDuplicatesPairRowCard row={query.data.right} side="right" />
          </div>

          <NearDuplicatesActionButtons
            pairId={pairId}
            left={query.data.left}
            right={query.data.right}
          />
        </>
      )}
    </div>
  );
}
