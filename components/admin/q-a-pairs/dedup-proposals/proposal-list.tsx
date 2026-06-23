'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Layers, Loader2 } from 'lucide-react';
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
import {
  fetchAdminQaDedupProposals,
  type QaDedupProposalSummary,
  type QaDedupStatusFilter,
} from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { QaDedupEmptyState } from './empty-state';
import { QaDedupFilterBar } from './filter-bar';

const SKELETON_ROWS = 5;
// Stable empty-array reference — prevents downstream useMemo deps from
// invalidating every render (CLAUDE.md "stable empty array/object defaults").
const EMPTY_PROPOSALS: QaDedupProposalSummary[] = [];

/**
 * ID-120 {120.8} cross-workspace Q&A dedup — curator queue (list) view
 * (TECH P-4). Renders the status filter bar, the proposal list, the empty
 * state, a loading skeleton, and an error panel with retry (INV-19).
 *
 * Data via TanStack Query exclusively. The status filter drives the cache key.
 */
export function QaDedupProposalListClient() {
  const [status, setStatus] = useState<QaDedupStatusFilter>('pending');

  const query = useQuery({
    queryKey: queryKeys.adminQaDedup.queue({ status }),
    queryFn: () => fetchAdminQaDedupProposals({ status }),
  });

  const data = query.data;
  const proposals = useMemo(() => data ?? EMPTY_PROPOSALS, [data]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground">
          Duplicate Q&amp;A proposals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review likely-duplicate Q&amp;A pairs surfaced across the
          organisation&rsquo;s workspaces and forms. Approve to merge (archiving
          the non-survivor), or reject to keep both.
        </p>
      </header>

      <QaDedupFilterBar
        status={status}
        totalCount={proposals.length}
        onStatusChange={setStatus}
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
              Failed to load dedup proposals
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching dedup proposals.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="qa-dedup-list-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : proposals.length === 0 ? (
        <QaDedupEmptyState status={status} />
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">
              {proposals.length} proposal{proposals.length === 1 ? '' : 's'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table
              className="w-full text-sm"
              aria-label="Duplicate Q&amp;A proposals"
            >
              <caption className="sr-only">
                Duplicate Q&amp;A pair proposals awaiting curator review.
              </caption>
              <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 w-32">
                    Match strength
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Proposal
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((proposal) => (
                  <ProposalRow key={proposal.id} proposal={proposal} />
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

interface ProposalRowProps {
  proposal: QaDedupProposalSummary;
}

/**
 * Single queue row. Similarity is shown as a subordinate numeric "match
 * strength" label only (INV-23) — never an AI-confidence headline. A proposal
 * that spans workspaces or forms carries a non-colour-only "spans
 * workspaces/forms" badge (INV-11/18) — the badge text, not colour alone,
 * carries the information (WCAG 2.1 AA).
 */
function ProposalRow({ proposal }: ProposalRowProps) {
  const spans = proposal.spansWorkspaces || proposal.spansForms;
  const spanLabel =
    proposal.spansWorkspaces && proposal.spansForms
      ? 'spans workspaces/forms'
      : proposal.spansWorkspaces
        ? 'spans workspaces'
        : 'spans forms';

  return (
    <tr
      className="border-b last:border-b-0 hover:bg-muted/40"
      data-testid={`qa-dedup-proposal-row-${proposal.id}`}
    >
      <td className="px-4 py-3 align-top">
        <span
          className="font-mono text-xs tabular-nums text-muted-foreground"
          data-testid={`qa-dedup-match-strength-${proposal.id}`}
        >
          {proposal.similarityScore.toFixed(3)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {proposal.survivorReason}
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-xs">
              {proposal.status}
            </Badge>
            {spans ? (
              <Badge
                variant="outline"
                className="gap-1 text-xs"
                data-testid={`qa-dedup-spans-badge-${proposal.id}`}
              >
                <Layers className="size-3" aria-hidden="true" />
                {spanLabel}
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
          data-testid={`qa-dedup-proposal-review-${proposal.id}`}
        >
          <Link href={`/admin/q-a-pairs/dedup-proposals/${proposal.id}`}>
            Review
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Button>
      </td>
    </tr>
  );
}
