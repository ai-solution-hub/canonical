'use client';

import { useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PenLine,
  PlayCircle,
  X,
} from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  fetchQaPromotionCandidates,
  postQaPromoteCorpus,
  postQaPromotionCandidateAccept,
  postQaPromotionCandidateEdit,
  postQaPromotionCandidateReject,
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
 * (TECH §5/§7 section I, BI-38). {145.22} composed the batch surface from
 * EXISTING backend only (`q_a_extractions_promotion_candidates()` RPC
 * {138.17} + `POST /api/q-a-pairs/promote-corpus` {59.25}). {145.30} (BI-38
 * amendment, DR-062, S470) LIFTS that "no new backend" constraint and adds
 * the per-candidate accept/edit/reject write path for the `awaiting_review`
 * bucket specifically — see
 * `lib/q-a-pairs/promotion-candidate-review.ts`'s module header for the full
 * scoping rationale (a 'new'/'self_healing' candidate has no per-item
 * judgement gap and stays batch-only).
 *
 * BI-39 human gate: the panel reads on mount but NEVER triggers a promotion
 * run automatically — a batch run happens only when a human clicks "Run
 * promotion pass", and a per-candidate accept/edit/reject happens only when
 * a human clicks that candidate's own action. An already-published-pair
 * text-drift diff (`kind: 'awaiting_review'`, DR-026) is NEVER auto-mutated
 * either way — only a human confirmation writes it.
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
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                queryClient={queryClient}
              />
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
  queryClient: QueryClient;
}

/**
 * {145.30}: per-item accept/edit/reject is offered ONLY for
 * `kind === 'awaiting_review'` — a 'new' or 'self_healing' candidate has no
 * per-item judgement gap (the batch "Run promotion pass" already resolves
 * both wholesale) and stays display-only here, matching the batch route's
 * own scope (lib/q-a-pairs/promotion-candidate-review.ts module header).
 */
function CandidateRow({ candidate, queryClient }: CandidateRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState(
    candidate.extractedQuestionText,
  );
  const [draftAnswer, setDraftAnswer] = useState(
    candidate.extractedAnswerText ?? '',
  );

  const invalidateAndToast = (message: string) => {
    toast.success(message);
    queryClient.invalidateQueries({
      queryKey: queryKeys.governancePromotion.all,
    });
  };

  const acceptMutation = useMutation({
    mutationFn: () => postQaPromotionCandidateAccept(candidate.id),
    onSuccess: () => invalidateAndToast('Candidate accepted.'),
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to accept candidate.',
      );
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => postQaPromotionCandidateReject(candidate.id),
    onSuccess: () => invalidateAndToast('Candidate rejected.'),
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to reject candidate.',
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: () =>
      postQaPromotionCandidateEdit(candidate.id, {
        question_text: draftQuestion,
        answer_standard: draftAnswer,
      }),
    onSuccess: () => {
      setIsEditing(false);
      invalidateAndToast('Candidate updated.');
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to update candidate.',
      );
    },
  });

  const isActionable = candidate.kind === 'awaiting_review';
  const isBusy =
    acceptMutation.isPending ||
    rejectMutation.isPending ||
    editMutation.isPending;

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3"
      data-testid={`promotion-gate-candidate-row-${candidate.id}`}
    >
      <Badge
        variant={candidate.kind === 'awaiting_review' ? 'outline' : 'secondary'}
        className="w-fit text-xs"
        data-testid={`promotion-gate-candidate-kind-${candidate.id}`}
      >
        {KIND_LABEL[candidate.kind]}
      </Badge>

      {isEditing ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`edit-question-${candidate.id}`}>Question</Label>
            <Textarea
              id={`edit-question-${candidate.id}`}
              value={draftQuestion}
              onChange={(e) => setDraftQuestion(e.target.value)}
              data-testid={`promotion-gate-candidate-edit-question-${candidate.id}`}
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`edit-answer-${candidate.id}`}>Answer</Label>
            <Textarea
              id={`edit-answer-${candidate.id}`}
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              data-testid={`promotion-gate-candidate-edit-answer-${candidate.id}`}
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => editMutation.mutate()}
              disabled={editMutation.isPending}
              data-testid={`promotion-gate-candidate-edit-save-${candidate.id}`}
            >
              {editMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setIsEditing(false);
                setDraftQuestion(candidate.extractedQuestionText);
                setDraftAnswer(candidate.extractedAnswerText ?? '');
              }}
              disabled={editMutation.isPending}
              data-testid={`promotion-gate-candidate-edit-cancel-${candidate.id}`}
            >
              <X className="size-4" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="line-clamp-2 text-sm text-foreground">
            {candidate.extractedQuestionText}
          </p>
          {isActionable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => acceptMutation.mutate()}
                disabled={isBusy}
                data-testid={`promotion-gate-candidate-accept-${candidate.id}`}
              >
                {acceptMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                )}
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditing(true)}
                disabled={isBusy}
                data-testid={`promotion-gate-candidate-edit-${candidate.id}`}
              >
                <PenLine className="size-4" aria-hidden="true" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => rejectMutation.mutate()}
                disabled={isBusy}
                data-testid={`promotion-gate-candidate-reject-${candidate.id}`}
              >
                {rejectMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
                Reject
              </Button>
            </div>
          ) : null}
        </>
      )}
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
            {summary.proposed === 1 ? '' : 's'} surfaced this run — reviewable
            above
          </p>
          <p className="text-xs text-muted-foreground">
            A curated (already-published) pair is never AUTO-mutated (DR-026); a
            reviewer accepts, edits, or rejects each one individually in the
            candidates list above.
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
