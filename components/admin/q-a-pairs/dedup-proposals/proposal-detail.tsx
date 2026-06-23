'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Layers, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchAdminQaDedupProposal } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { QaDedupActionButtons } from './action-buttons';
import { QaDedupProposalRowCard } from './proposal-row-card';

interface QaDedupProposalDetailClientProps {
  proposalId: string;
}

/**
 * ID-120 {120.8} cross-workspace Q&A dedup — detail / resolve view
 * (TECH P-4 / INV-10/13/18). Renders both pair members side-by-side (both
 * questions AND both answers, with provenance + DD/MM/YYYY), the survivor
 * nomination + reason, the spans-workspaces/forms badge, the subordinate
 * match-strength score, and the per-pair approve/reject + override actions.
 *
 * Explicit loading (spinner) + error (panel + retry) states (INV-19).
 */
export function QaDedupProposalDetailClient({
  proposalId,
}: QaDedupProposalDetailClientProps) {
  const query = useQuery({
    queryKey: queryKeys.adminQaDedup.proposal(proposalId),
    queryFn: () => fetchAdminQaDedupProposal(proposalId),
  });

  const proposal = query.data;
  const spans = proposal
    ? proposal.spansWorkspaces || proposal.spansForms
    : false;
  const spanLabel =
    proposal?.spansWorkspaces && proposal?.spansForms
      ? 'spans workspaces/forms'
      : proposal?.spansWorkspaces
        ? 'spans workspaces'
        : 'spans forms';
  const survivorId = proposal
    ? (proposal.resolvedSurvivorId ?? proposal.proposedSurvivorId)
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/q-a-pairs/dedup-proposals" className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to proposal list
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
              Loading dedup proposal…
            </span>
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card role="alert" className="border-status-error/30 bg-status-error/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-status-error">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Failed to load dedup proposal
            </CardTitle>
            <CardDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Unknown error fetching the proposal detail.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              data-testid="qa-dedup-detail-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : !proposal ? null : (
        <>
          <header>
            <h1 className="text-xl font-semibold">
              Resolve duplicate proposal
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                data-testid="qa-dedup-detail-match-strength"
              >
                Match strength: {proposal.similarityScore.toFixed(3)}
              </Badge>
              <Badge variant="secondary">{proposal.status}</Badge>
              {spans ? (
                <Badge
                  variant="outline"
                  className="gap-1"
                  data-testid="qa-dedup-detail-spans-badge"
                >
                  <Layers className="size-3" aria-hidden="true" />
                  {spanLabel}
                </Badge>
              ) : null}
            </div>
          </header>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-sm">Nominated survivor</CardTitle>
              <CardDescription
                className="text-xs"
                data-testid="qa-dedup-survivor-reason"
              >
                {proposal.survivorReason}
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <QaDedupProposalRowCard
              member={proposal.pairA}
              side="a"
              isSurvivor={survivorId === proposal.pairA.id}
            />
            <QaDedupProposalRowCard
              member={proposal.pairB}
              side="b"
              isSurvivor={survivorId === proposal.pairB.id}
            />
          </div>

          {proposal.status === 'pending' ? (
            <QaDedupActionButtons
              proposalId={proposalId}
              pairA={proposal.pairA}
              pairB={proposal.pairB}
              proposedSurvivorId={proposal.proposedSurvivorId}
            />
          ) : (
            <p
              className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
              data-testid="qa-dedup-already-resolved"
            >
              This proposal is already {proposal.status}. No further action is
              available.
            </p>
          )}
        </>
      )}
    </div>
  );
}
