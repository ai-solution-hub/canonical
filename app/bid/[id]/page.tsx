'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Hash,
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BidStateBadge, BidStateStepper } from '@/components/bid-state-indicator';
import { BidExportMenu } from '@/components/bid-export-menu';
import { CostEstimateDialog } from '@/components/cost-estimate-dialog';
import { BidOutcomeDialog } from '@/components/bid-outcome';
import { KBIntegrationReview } from '@/components/kb-integration-review';
import { ConfidenceDot } from '@/components/confidence-badge';
import { QuestionList } from '@/components/question-list';
import { QuestionReview } from '@/components/question-review';
import { TenderUpload } from '@/components/tender-upload';
import { useUserRole } from '@/hooks/use-user-role';
import { formatDateUK } from '@/lib/format';
import { canTransition, getAvailableTransitions, BID_STATE_LABELS } from '@/lib/bid-state-machine';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Bid, BidMetadata, BidQuestion, BidQuestionStats, TenderDocument, ConfidencePosture, BidState, ExtractionResult, KBCandidate } from '@/types/bid';

type Tab = 'overview' | 'questions' | 'responses' | 'documents';

export default function BidDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { canEdit, role } = useUserRole();
  const [bid, setBid] = useState<Bid | null>(null);
  const [questions, setQuestions] = useState<BidQuestion[]>([]);
  const [stats, setStats] = useState<BidQuestionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [transitioning, setTransitioning] = useState(false);
  const [showQuestionReview, setShowQuestionReview] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<Array<{
    section_name: string;
    section_sequence: number;
    question_sequence: number;
    question_text: string;
    word_limit: number | null;
    category: string;
  }>>([]);
  const [showCostEstimate, setShowCostEstimate] = useState(false);
  const [draftingAll, setDraftingAll] = useState(false);
  const [showOutcomeDialog, setShowOutcomeDialog] = useState(false);
  const [showKBReview, setShowKBReview] = useState(false);
  const [kbCandidates, setKBCandidates] = useState<KBCandidate[]>([]);

  const fetchBid = useCallback(async () => {
    try {
      const response = await fetch(`/api/bids/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          toast.error('Bid not found');
          router.push('/bid');
          return;
        }
        throw new Error('Failed to fetch bid');
      }
      const data = await response.json();
      setBid(data);
      setStats(data.question_stats ?? null);
    } catch {
      toast.error('Failed to load bid');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  const fetchQuestions = useCallback(async () => {
    try {
      const response = await fetch(`/api/bids/${id}/questions`);
      if (!response.ok) return;
      const data = await response.json();
      setQuestions(data.questions ?? []);
      if (data.stats) setStats(data.stats);
    } catch {
      // Non-critical, questions tab still shows empty
    }
  }, [id]);

  useEffect(() => {
    fetchBid();
    fetchQuestions();
  }, [fetchBid, fetchQuestions]);

  async function handleStatusTransition(newStatus: BidState) {
    if (!bid) return;
    const currentStatus = (bid.status ?? (bid.domain_metadata as BidMetadata).status) as BidState;
    if (!canTransition(currentStatus, newStatus)) {
      toast.error(`Cannot transition from ${BID_STATE_LABELS[currentStatus]} to ${BID_STATE_LABELS[newStatus]}`);
      return;
    }

    setTransitioning(true);
    try {
      const body: Record<string, string> = { status: newStatus };
      if (newStatus === 'submitted') {
        body.submission_date = new Date().toISOString();
      }

      const response = await fetch(`/api/bids/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update status');
      }

      toast.success(`Bid moved to ${BID_STATE_LABELS[newStatus]}`);
      fetchBid();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setTransitioning(false);
    }
  }

  function handleUploadComplete(result?: ExtractionResult) {
    fetchBid();
    fetchQuestions();
    if (result && result.sections.length > 0) {
      // Flatten sections into individual question entries for QuestionReview
      const flattened = result.sections.flatMap((section) =>
        section.questions.map((q) => ({
          section_name: section.section_name,
          section_sequence: section.section_sequence,
          question_sequence: q.question_sequence,
          question_text: q.question_text,
          word_limit: q.word_limit,
          category: q.category,
        })),
      );
      setExtractedQuestions(flattened);
      setShowQuestionReview(true);
      setActiveTab('questions');
    }
  }

  function handleQuestionReviewConfirmed() {
    setShowQuestionReview(false);
    setExtractedQuestions([]);
    fetchQuestions();
    fetchBid();
  }

  function handleQuestionReviewCancelled() {
    setShowQuestionReview(false);
    setExtractedQuestions([]);
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this bid? This cannot be undone.')) return;

    try {
      const response = await fetch(`/api/bids/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete bid');
      }
      toast.success('Bid deleted');
      router.push('/bid');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete bid');
    }
  }

  async function handleMatchQuestions() {
    try {
      const response = await fetch(`/api/bids/${id}/questions/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to match questions');
      }

      const result = await response.json();
      toast.success(`Matched ${result.matched} questions against KB`);
      fetchBid();
      fetchQuestions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to match questions');
    }
  }

  async function handleDraftAll() {
    setDraftingAll(true);
    try {
      const response = await fetch(`/api/bids/${id}/responses/draft-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip_existing: true }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to draft responses');
      }

      const result = await response.json();
      const { drafted, skipped, failed } = result;

      if (failed > 0) {
        toast.warning(`Drafted ${drafted} responses, ${failed} failed, ${skipped} skipped`);
      } else {
        toast.success(`Drafted ${drafted} responses (${skipped} skipped)`);
      }

      if (result.total_cost > 0) {
        toast.info(`Total cost: $${result.total_cost.toFixed(4)}`);
      }

      fetchBid();
      fetchQuestions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to draft responses');
    } finally {
      setDraftingAll(false);
    }
  }

  function handleOutcomeRecorded(outcome: string, candidates: KBCandidate[]) {
    setShowOutcomeDialog(false);
    fetchBid();
    if (candidates.length > 0) {
      setKBCandidates(candidates);
      setShowKBReview(true);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <BidDetailSkeleton />
      </div>
    );
  }

  if (!bid) return null;

  const metadata = bid.domain_metadata as BidMetadata;
  const bidStatus = (bid.status ?? metadata.status) as BidState;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount = (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent = totalQuestions > 0 ? Math.round((completedCount / totalQuestions) * 100) : 0;
  const availableTransitions = getAvailableTransitions(bidStatus);
  const outcomeTransitions = ['won', 'lost', 'withdrawn'] as const;
  const isSubmitted = bidStatus === 'submitted';
  const regularTransitions = availableTransitions.filter(
    t => !isSubmitted || !outcomeTransitions.includes(t as typeof outcomeTransitions[number]),
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'questions', label: 'Questions', count: totalQuestions },
    { id: 'responses', label: 'Responses' },
    { id: 'documents', label: 'Documents', count: metadata.tender_document_ids?.length ?? 0 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Back link */}
      <Link
        href="/bid"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Bids
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{bid.name}</h1>
            <BidStateBadge state={bidStatus} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {metadata.buyer && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden="true" />
                {metadata.buyer}
              </span>
            )}
            {metadata.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden="true" />
                {formatDateUK(metadata.deadline)}
              </span>
            )}
            {metadata.reference_number && (
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-3.5" aria-hidden="true" />
                {metadata.reference_number}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {canEdit && (
          <div className="flex items-center gap-2">
            {regularTransitions.filter(t => t !== 'withdrawn').length > 0 && (
              <div className="flex items-center gap-1">
                {regularTransitions.filter(t => t !== 'withdrawn').map((transition) => (
                  <Button
                    key={transition}
                    variant="outline"
                    size="sm"
                    onClick={() => handleStatusTransition(transition)}
                    disabled={transitioning}
                  >
                    {transitioning ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    {BID_STATE_LABELS[transition]}
                  </Button>
                ))}
              </div>
            )}
            {isSubmitted && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOutcomeDialog(true)}
              >
                Record Outcome
              </Button>
            )}
            <BidExportMenu
              bidId={id}
              bidName={bid.name}
              hasQuestions={totalQuestions > 0}
            />
            <a href={`/bid/${id}/session`}>
              <Button variant="default" size="sm">
                <FileText className="mr-1.5 size-4" aria-hidden="true" />
                Open Session
              </Button>
            </a>
            {role === 'admin' && (
              <Button variant="ghost" size="icon-sm" onClick={handleDelete} title="Delete bid">
                <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                <span className="sr-only">Delete bid</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* State stepper */}
      <div className="mt-4">
        <BidStateStepper state={bidStatus} />
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b">
        <nav className="flex gap-4" aria-label="Bid sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative pb-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {tab.count}
                </span>
              )}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {activeTab === 'overview' && (
          <OverviewTab
            bid={bid}
            bidId={id}
            stats={stats}
            progressPercent={progressPercent}
            completedCount={completedCount}
            totalQuestions={totalQuestions}
            canEdit={canEdit}
            onMatchQuestions={handleMatchQuestions}
            showCostEstimate={showCostEstimate}
            onShowCostEstimate={setShowCostEstimate}
            draftingAll={draftingAll}
            onDraftAll={handleDraftAll}
          />
        )}
        {activeTab === 'questions' && (
          <>
            {showQuestionReview && extractedQuestions.length > 0 && (
              <div className="mb-6 rounded-lg border bg-card p-4">
                <QuestionReview
                  bidId={id}
                  questions={extractedQuestions}
                  onConfirmed={handleQuestionReviewConfirmed}
                  onCancelled={handleQuestionReviewCancelled}
                />
              </div>
            )}
            <QuestionList
              bidId={id}
              questions={questions}
              canEdit={canEdit}
              onQuestionsChanged={() => { fetchQuestions(); fetchBid(); }}
            />
          </>
        )}
        {activeTab === 'responses' && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <FileText className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="mt-3 text-sm text-muted-foreground">
              Draft and review responses in the AI-powered workspace.
            </p>
            <a
              href={`/bid/${id}/session`}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open Drafting Session
            </a>
          </div>
        )}
        {activeTab === 'documents' && (
          <DocumentsTab
            bidId={id}
            tenderDocuments={bid.tender_documents ?? []}
            canEdit={canEdit}
            onUploadComplete={handleUploadComplete}
          />
        )}
      </div>

      {/* Outcome dialog (submitted bids) */}
      <BidOutcomeDialog
        open={showOutcomeDialog}
        onOpenChange={setShowOutcomeDialog}
        bidId={id}
        bidName={bid.name}
        onOutcomeRecorded={handleOutcomeRecorded}
      />

      {/* KB integration review (after won outcome) */}
      <KBIntegrationReview
        open={showKBReview}
        onOpenChange={setShowKBReview}
        bidId={id}
        bidName={bid.name}
        candidates={kbCandidates}
        onIntegrationComplete={(result) => {
          setShowKBReview(false);
          setKBCandidates([]);
          fetchBid();
          toast.success(
            `KB integration complete: ${result.created} created, ${result.updated} updated`,
          );
        }}
      />
    </div>
  );
}

function OverviewTab({
  bid,
  bidId,
  stats,
  progressPercent,
  completedCount,
  totalQuestions,
  canEdit,
  onMatchQuestions,
  showCostEstimate,
  onShowCostEstimate,
  draftingAll,
  onDraftAll,
}: {
  bid: Bid;
  bidId: string;
  stats: BidQuestionStats | null;
  progressPercent: number;
  completedCount: number;
  totalQuestions: number;
  canEdit: boolean;
  onMatchQuestions: () => void;
  showCostEstimate: boolean;
  onShowCostEstimate: (open: boolean) => void;
  draftingAll: boolean;
  onDraftAll: () => void;
}) {
  const metadata = bid.domain_metadata as BidMetadata;
  const overviewStatus = (bid.status ?? metadata.status) as BidState;
  const postureBreakdown = stats ? ([
    { posture: 'strong_match' as ConfidencePosture, count: stats.strong_match_count },
    { posture: 'partial_match' as ConfidencePosture, count: stats.partial_match_count },
    { posture: 'needs_sme' as ConfidencePosture, count: stats.needs_sme_count },
    { posture: 'no_content' as ConfidencePosture, count: stats.no_content_count },
  ]).filter(p => p.count > 0) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Progress */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Progress</h2>
        {totalQuestions > 0 ? (
          <div className="mt-3 space-y-2">
            <Progress value={progressPercent} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {completedCount} of {totalQuestions} questions drafted ({progressPercent}%)
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No questions extracted yet. Upload a tender document to get started.
          </p>
        )}
      </div>

      {/* Draft All Responses action */}
      {canEdit && totalQuestions > 0 && ['drafting', 'in_review'].includes(overviewStatus) && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">AI Drafting</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Draft all eligible questions using the three-pass AI pipeline
            (analysis, drafting, quality check).
          </p>
          <Button
            variant="default"
            size="sm"
            className="mt-3 gap-1.5"
            disabled={draftingAll}
            onClick={() => onShowCostEstimate(true)}
          >
            {draftingAll ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-3.5" aria-hidden="true" />
            )}
            {draftingAll ? 'Drafting...' : 'Draft All Responses'}
          </Button>
          <CostEstimateDialog
            open={showCostEstimate}
            onOpenChange={onShowCostEstimate}
            bidId={bidId}
            onProceed={onDraftAll}
          />
        </div>
      )}

      {/* Confidence breakdown */}
      {postureBreakdown.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">Confidence Breakdown</h2>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {postureBreakdown.map(({ posture, count }) => (
              <ConfidenceDot key={posture} posture={posture} count={count} />
            ))}
          </div>
          {stats && stats.unmatched_count > 0 && canEdit && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={onMatchQuestions}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Match {stats.unmatched_count} unmatched questions
            </Button>
          )}
        </div>
      )}

      {/* Bid details */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Details</h2>
        <dl className="mt-3 space-y-2 text-sm">
          {metadata.estimated_value && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Estimated Value</dt>
              <dd className="font-medium">{metadata.estimated_value}</dd>
            </div>
          )}
          {metadata.reference_number && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-medium">{metadata.reference_number}</dd>
            </div>
          )}
          {metadata.deadline && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Deadline</dt>
              <dd className="font-medium">{formatDateUK(metadata.deadline)}</dd>
            </div>
          )}
          {bid.description && (
            <div>
              <dt className="text-muted-foreground">Description</dt>
              <dd className="mt-1 text-foreground">{bid.description}</dd>
            </div>
          )}
          {metadata.notes && (
            <div>
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="mt-1 text-foreground">{metadata.notes}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Tender documents summary */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Tender Documents</h2>
        {(bid.tender_documents?.length ?? 0) > 0 ? (
          <ul className="mt-3 space-y-2">
            {bid.tender_documents?.map((doc) => (
              <li key={doc.path} className="flex items-center gap-2 text-sm">
                <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{doc.filename}</span>
                <span className="text-xs text-muted-foreground">
                  ({Math.round(doc.size / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No tender documents uploaded yet.
          </p>
        )}
      </div>
    </div>
  );
}

function DocumentsTab({
  bidId,
  tenderDocuments,
  canEdit,
  onUploadComplete,
}: {
  bidId: string;
  tenderDocuments: TenderDocument[];
  canEdit: boolean;
  onUploadComplete: (result?: ExtractionResult) => void;
}) {
  return (
    <div className="space-y-6">
      {canEdit && (
        <TenderUpload bidId={bidId} onUploadComplete={onUploadComplete} />
      )}

      {tenderDocuments.length > 0 ? (
        <div className="rounded-lg border">
          <div className="p-4">
            <h2 className="text-sm font-medium text-foreground">
              Uploaded Documents ({tenderDocuments.length})
            </h2>
          </div>
          <div className="divide-y">
            {tenderDocuments.map((doc) => (
              <div key={doc.path} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(doc.size / 1024)} KB
                    {doc.uploaded_at && ` · Uploaded ${formatDateUK(doc.uploaded_at)}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Upload className="size-8 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">
            No tender documents uploaded yet.
          </p>
        </div>
      )}
    </div>
  );
}

function BidDetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="mt-4 flex items-center gap-3">
        <div className="h-6 w-64 rounded bg-muted" />
        <div className="h-6 w-20 rounded-full bg-muted" />
      </div>
      <div className="mt-3 flex gap-4">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-4 w-28 rounded bg-muted" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-32 rounded-lg border bg-card" />
        ))}
      </div>
    </div>
  );
}
