'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
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
  fetchQaPromotionCandidates,
  postQaPromoteCorpus,
  type QaPromotionCandidate,
  type QaPromotionCandidateKind,
} from '@/lib/query/fetchers';
import type { PromotionSummary } from '@/lib/q-a-pairs/promote-corpus';
import { queryKeys } from '@/lib/query/query-keys';

const SKELETON_ROWS = 4;
// Stable empty-array reference — prevents downstream useMemo/render
// invalidation every render (CLAUDE.md "stable empty array/object defaults").
const EMPTY_CANDIDATES: QaPromotionCandidate[] = [];

/** Non-colour-only label per `QaPromotionCandidateKind` (WCAG 2.1 AA). */
const KIND_LABEL: Record<QaPromotionCandidateKind, string> = {
  new: 'New',
  self_healing: 'Self-healing',
  awaiting_review: 'Awaiting review',
};

/**
 * ID-145 {145.22} Governance promotion-gate — the promotion-candidates half
 * (TECH §5/§7 section I, BI-38). Composes the EXISTING
 * `q_a_extractions_promotion_candidates()` RPC ({138.17}) and the EXISTING
 * `POST /api/q-a-pairs/promote-corpus` route ({59.25}) — no new backend.
 *
 * BI-39 human gate: the panel reads on mount but NEVER triggers a promotion
 * run automatically — a run happens only when a human clicks "Run promotion
 * pass". An already-published-pair text-drift diff (`kind: 'awaiting_review'`,
 * DR-026) is rendered but is never offered an accept/reject action — no such
 * write path exists yet (progressive trust, TECH §2.4); the run summary's
 * `proposals[]` is shown read-only.
 */
export function PromotionCandidatesPanel() {
  const queryClient = useQueryClient();

  const candidatesQuery = useQuery({
    queryKey: queryKeys.governancePromotion.candidates(),
    queryFn: fetchQaPromotionCandidates,
  });

  const runMutation = useMutation({
    mutationFn: postQaPromoteCorpus,
    onSuccess: (summary) => {
      toast.success(
        `Promotion run complete — ${summary.promoted} promoted, ${summary.proposed} awaiting review`,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.governancePromotion.all,
      });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to run promotion pass',
      );
    },
  });

  const candidates = candidatesQuery.data ?? EMPTY_CANDIDATES;

  return (
    <section
      aria-labelledby="promotion-candidates-heading"
      className="flex flex-col gap-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="promotion-candidates-heading"
            className="text-lg font-semibold text-foreground"
          >
            Promotion candidates
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Driven by the existing corpus-extraction eligibility set. Running a
            pass promotes new and self-healing candidates; an already-published
            pair is never auto-mutated (DR-026) — a text-drift diff surfaces
            below for review only.
          </p>
        </div>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending}
          data-testid="promotion-gate-run-trigger"
        >
          {runMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlayCircle className="size-4" aria-hidden="true" />
          )}
          Run promotion pass
        </Button>
      </header>

      {candidatesQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            {Array.from({ length: SKELETON_ROWS }).map((_, idx) => (
              <Skeleton key={idx} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : candidatesQuery.isError ? (
        <Card role="alert" className="border-status-error/30 bg-status-error/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-status-error">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Failed to load promotion candidates
            </CardTitle>
            <CardDescription>
              {candidatesQuery.error instanceof Error
                ? candidatesQuery.error.message
                : 'Unknown error fetching promotion candidates.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => candidatesQuery.refetch()}
              data-testid="promotion-gate-list-retry"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2
              className="mx-auto size-10 text-status-success"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm text-muted-foreground">
              No promotion candidates waiting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">
              {candidates.length} candidate
              {candidates.length === 1 ? '' : 's'}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.id} candidate={candidate} />
            ))}
          </CardContent>
        </Card>
      )}

      {runMutation.data ? <RunSummaryCard summary={runMutation.data} /> : null}
    </section>
  );
}

interface CandidateRowProps {
  candidate: QaPromotionCandidate;
}

function CandidateRow({ candidate }: CandidateRowProps) {
  return (
    <div
      className="flex flex-col gap-1 px-4 py-3"
      data-testid={`promotion-gate-candidate-row-${candidate.id}`}
    >
      <Badge
        variant={candidate.kind === 'awaiting_review' ? 'outline' : 'secondary'}
        className="w-fit text-xs"
        data-testid={`promotion-gate-candidate-kind-${candidate.id}`}
      >
        {KIND_LABEL[candidate.kind]}
      </Badge>
      <p className="line-clamp-2 text-sm text-foreground">
        {candidate.extractedQuestionText}
      </p>
    </div>
  );
}

interface RunSummaryCardProps {
  summary: PromotionSummary;
}

function RunSummaryCard({ summary }: RunSummaryCardProps) {
  return (
    <Card data-testid="promotion-gate-run-summary">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Last run</CardTitle>
        <CardDescription>
          Considered {summary.considered} · Promoted {summary.promoted} ·
          Already promoted {summary.already_promoted} · Embed failed{' '}
          {summary.embed_failed} · Retired{' '}
          {summary.retired + summary.retired_no_replacement}
        </CardDescription>
      </CardHeader>
      {summary.proposed > 0 ? (
        <CardContent className="space-y-2 pt-4">
          <p className="text-sm font-medium text-foreground">
            {summary.proposed} published-pair diff
            {summary.proposed === 1 ? '' : 's'} — review only, not yet
            actionable
          </p>
          <p className="text-xs text-muted-foreground">
            A curated (already-published) pair is never auto-mutated (DR-026).
            These extractions re-walked with different text, but no
            accept/reject action exists yet — progressive trust earns it.
          </p>
          <ul className="space-y-1">
            {summary.proposals.map((proposal) => (
              <li
                key={proposal.extractionId}
                className="font-mono text-xs text-muted-foreground"
              >
                extraction {proposal.extractionId} → pair {proposal.pairId}
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
