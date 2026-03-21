'use client';

import { use } from 'react';
import { handleTablistKeyDown } from '@/lib/tablist-keyboard';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Calendar,
  ClipboardList,
  Hash,
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  Loader2,
  Sparkles,
  MoreHorizontal,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BidStateBadge, BidStateStepper } from '@/components/bid-state-indicator';
import { BidExportMenu } from '@/components/bid-export-menu';
import { CostEstimateDialog } from '@/components/cost-estimate-dialog';
import { BidOutcomeDialog } from '@/components/bid-outcome';
import { KBIntegrationReview } from '@/components/kb-integration-review';
import { ConfidenceDot } from '@/components/confidence-badge';
import { QuestionList } from '@/components/question-list';
import { QuestionReview } from '@/components/question-review';
import { TenderUpload } from '@/components/tender-upload';
import { TenderMetadataPrompt } from '@/components/tender-metadata-prompt';
import { useUserRole } from '@/hooks/use-user-role';
import { useBidActions } from '@/hooks/use-bid-actions';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/bid-helpers';
import { BID_STATE_LABELS } from '@/lib/bid-state-machine';
import { cn } from '@/lib/utils';
import type { Bid, BidMetadata, BidQuestionStats, TenderDocument, ConfidencePosture, BidState, ExtractionResult } from '@/types/bid';

export default function BidDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canEdit, role } = useUserRole();
  const {
    bid,
    questions,
    stats,
    loading,
    activeTab,
    setActiveTab,
    transitioning,
    showQuestionReview,
    extractedQuestions,
    showCostEstimate,
    setShowCostEstimate,
    draftingAll,
    showOutcomeDialog,
    setShowOutcomeDialog,
    showKBReview,
    setShowKBReview,
    kbCandidates,
    extractedMetadata,
    handleStatusTransition,
    handleUploadComplete,
    handleQuestionReviewConfirmed,
    handleQuestionReviewCancelled,
    handleDelete,
    handleMatchQuestions,
    handleDraftAll,
    handleOutcomeRecorded,
    clearExtractedMetadata,
    handleKBIntegrationComplete,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    handleDeleteConfirmed,
    fetchBid,
    fetchQuestions,
    metadata,
    bidStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    isSubmitted,
    regularTransitions,
    tabs,
  } = useBidActions({ id });

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <BidDetailSkeleton />
      </div>
    );
  }

  if (!bid || !bidStatus) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Link
          href="/bid"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Bids
        </Link>
        <div className="mt-8 flex flex-col items-center justify-center py-20 text-center" role="alert">
          <AlertCircle className="size-10 text-muted-foreground/50" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-foreground">Bid not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This bid may have been deleted or you may not have access.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/bid">Return to Bids</Link>
          </Button>
        </div>
      </div>
    );
  }

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
            {metadata?.buyer && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden="true" />
                {metadata.buyer}
              </span>
            )}
            {metadata?.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden="true" />
                {formatDateUK(metadata.deadline)}
                {(() => {
                  const proximity = getDeadlineProximity(metadata.deadline);
                  if (!proximity) return null;
                  return (
                    <span
                      className={cn(
                        'ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        proximity.isOverdue
                          ? 'bg-bid-overdue-bg text-bid-overdue border border-bid-overdue-border'
                          : 'bg-status-warning/10 text-status-warning',
                      )}
                    >
                      {proximity.label}
                    </span>
                  );
                })()}
              </span>
            )}
            {metadata?.reference_number && (
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
                    aria-label={BID_STATE_LABELS[transition]}
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
            <Button asChild variant="default" size="sm">
              <Link href={`/bid/${id}/session`}>
                <FileText className="mr-1.5 size-4" aria-hidden="true" />
                Open Session
              </Link>
            </Button>
            {role === 'admin' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="More actions"
                  >
                    <MoreHorizontal
                      className="size-4"
                      aria-hidden="true"
                    />
                    <span className="sr-only">More actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2
                      className="mr-2 size-4"
                      aria-hidden="true"
                    />
                    Delete bid
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* Extracted metadata prompt */}
      {extractedMetadata && (
        <div className="mt-4 rounded-lg border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)] p-4">
          <TenderMetadataPrompt
            metadata={extractedMetadata}
            bidId={id}
            onUpdated={clearExtractedMetadata}
          />
        </div>
      )}

      {/* State stepper */}
      <div className="mt-4">
        <BidStateStepper state={bidStatus} />
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b">
        <div className="flex gap-4" role="tablist" aria-label="Bid sections" onKeyDown={handleTablistKeyDown}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`bid-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="bid-tabpanel"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative pb-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {tab.count}
                </span>
              )}
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-all duration-200',
                  activeTab === tab.id ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0',
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="mt-6" role="tabpanel" id="bid-tabpanel" aria-labelledby={`bid-tab-${activeTab}`}>
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
            onSwitchTab={setActiveTab}
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
            {/* Bulk actions for question list tab */}
            {canEdit && totalQuestions > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {stats && stats.unmatched_count > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleMatchQuestions}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Match {stats.unmatched_count} Unmatched
                  </Button>
                )}
                {['drafting', 'in_review'].includes(bidStatus) && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    disabled={draftingAll}
                    onClick={() => setShowCostEstimate(true)}
                  >
                    {draftingAll ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden="true" />
                    )}
                    {draftingAll ? 'Drafting...' : 'Draft All'}
                  </Button>
                )}
                <CostEstimateDialog
                  open={showCostEstimate}
                  onOpenChange={setShowCostEstimate}
                  bidId={id}
                  onProceed={handleDraftAll}
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
            <Button asChild className="mt-4">
              <Link href={`/bid/${id}/session`}>
                Open Drafting Session
              </Link>
            </Button>
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
        onIntegrationComplete={handleKBIntegrationComplete}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bid</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{bid?.name}&rdquo;? This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  onSwitchTab,
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
  onSwitchTab: (tab: 'overview' | 'questions' | 'responses' | 'documents') => void;
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
          <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
            <Upload className="size-6 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No questions extracted yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Questions will be automatically extracted from your tender document.
            </p>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1.5"
                onClick={() => onSwitchTab('documents')}
              >
                <Upload className="size-3.5" aria-hidden="true" />
                Upload Document
              </Button>
            )}
          </div>
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

      {/* Bid details — spans 2 columns when confidence card is absent to avoid grid asymmetry */}
      {(() => {
        const hasDetails = metadata.estimated_value || metadata.reference_number || metadata.deadline || bid.description || metadata.notes;
        return (
          <div className={cn(
            'rounded-lg border bg-card p-4',
            postureBreakdown.length === 0 && 'lg:col-span-2',
          )}>
            <h2 className="text-sm font-medium text-foreground">Details</h2>
            {hasDetails ? (
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
            ) : (
              <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
                <ClipboardList className="size-6 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  No details added yet.
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Add bid details like deadline, estimated value, and reference number to track this opportunity.
                </p>
              </div>
            )}
          </div>
        );
      })()}

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
          <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
            <Upload className="size-6 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No tender documents uploaded yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Upload your tender document to extract questions and start drafting responses.
            </p>
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="mt-1 gap-1.5"
                onClick={() => onSwitchTab('documents')}
              >
                <Upload className="size-3.5" aria-hidden="true" />
                Go to Documents
              </Button>
            )}
          </div>
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
