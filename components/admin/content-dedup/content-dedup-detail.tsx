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
import { queryKeys } from '@/lib/query/query-keys';
import { fetchAdminDedupItem } from '@/lib/query/fetchers';
import { ContentDedupActionButtons } from './content-dedup-action-buttons';
import { ContentDedupRowCard } from './content-dedup-row-card';

interface ContentDedupDetailClientProps {
  id: string;
}

/**
 * Detail-and-resolve view at `/admin/content-dedup/[id]`.
 *
 * Renders side-by-side {@link ContentDedupRowCard}s for the suspected
 * duplicate (subject) and its canonical match (where present), then the
 * {@link ContentDedupActionButtons} resolution surface.
 *
 * If `canonical` is null (the soft-block stamp recorded a non-existent
 * match — rare), the page surfaces a warning and disables the supersede
 * action; confirm-duplicate and confirm-unique still work.
 *
 * Spec: `docs/specs/§1.7-admin-dedup-review-spec.md` §6.2.
 */
export function ContentDedupDetailClient({
  id,
}: ContentDedupDetailClientProps) {
  const query = useQuery({
    queryKey: queryKeys.adminDedup.item(id),
    queryFn: () => fetchAdminDedupItem(id),
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/content-dedup" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to queue
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
              Loading dedup item…
            </span>
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card
          role="alert"
          className="border-status-error/30 bg-status-error/5"
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-status-error">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Failed to load dedup item
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching the dedup item.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="dedup-detail-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : !query.data ? null : (
        <>
          <header>
            <h1 className="text-xl font-semibold">
              Resolve duplicate:{' '}
              <span className="font-normal">
                {query.data.subject.title?.trim() ?? 'Untitled'}
              </span>
            </h1>
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                Similarity: {query.data.similarity.toFixed(2)}
                {query.data.similarity >= 1 ? ' (exact)' : ''}
              </Badge>
            </div>
          </header>

          {query.data.canonical ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ContentDedupRowCard
                row={query.data.subject}
                label="subject"
              />
              <ContentDedupRowCard
                row={query.data.canonical}
                label="canonical"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              <ContentDedupRowCard
                row={query.data.subject}
                label="subject"
              />
              <Card
                role="status"
                className="border-status-warning/30 bg-status-warning/5"
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle
                      className="size-4 text-status-warning"
                      aria-hidden="true"
                    />
                    No canonical match found in metadata
                  </CardTitle>
                  <CardDescription>
                    The soft-block stamp did not record a canonical match for
                    this row, or the canonical was archived. Supersede is
                    disabled — confirm duplicate or confirm unique remain
                    available.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          )}

          <ContentDedupActionButtons
            subject={query.data.subject}
            canonical={query.data.canonical}
          />
        </>
      )}
    </div>
  );
}
