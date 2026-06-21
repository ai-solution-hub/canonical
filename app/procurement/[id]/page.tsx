'use client';

import { use, useState } from 'react';
import { handleTablistKeyDown } from '@/lib/tablist-keyboard';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  Building2,
  Calendar,
  ClipboardList,
  Download,
  Eye,
  Hash,
  FileText,
  Upload,
  RefreshCw,
  Trash2,
  Loader2,
  PenLine,
  MoreHorizontal,
  AlertCircle,
  Sheet,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { toast } from 'sonner';
import {
  ProcurementWorkflowBadge,
  ProcurementWorkflowStepper,
} from '@/components/procurement/procurement-workflow-indicator';
import { ProcurementExportMenu } from '@/components/procurement/procurement-export-menu';
import {
  ReadinessChecklist,
  ReadinessBadge,
} from '@/components/procurement/readiness-checklist';
import { CostEstimateDialog } from '@/components/coverage/cost-estimate-dialog';
import { ProcurementOutcomeDialog } from '@/components/procurement/procurement-outcome';
import { KBIntegrationReview } from '@/components/procurement/kb-integration-review';
import { ConfidenceDot } from '@/components/shared/confidence-badge';
import { QuestionList } from '@/components/procurement/question-list';
import { QuestionReview } from '@/components/procurement/question-review';
import { TenderUpload } from '@/components/procurement/tender-upload';
import { TenderMetadataPrompt } from '@/components/procurement/tender-metadata-prompt';
import { useUserRole } from '@/hooks/use-user-role';
import { useFormActions } from '@/hooks/procurement/use-procurement-actions';
import { useBidExport } from '@/hooks/procurement/use-procurement-export';
import { useBidReadiness } from '@/hooks/procurement/use-procurement-readiness';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/procurement/procurement-helpers';
import { PROCUREMENT_WORKFLOW_LABELS } from '@/lib/procurement/procurement-workflow';
import { cn } from '@/lib/utils';
import type {
  Procurement,
  ProcurementMetadata,
  ProcurementQuestionStats,
  TenderDocument,
  ConfidencePosture,
  ProcurementWorkflowState,
  ExtractionResult,
} from '@/types/procurement';

export default function ProcurementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
    fetchProcurement,
    fetchQuestions,
    metadata,
    procurementStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    isSubmitted,
    regularTransitions,
    tabs,
  } = useFormActions({ id });

  const {
    readiness,
    isLoading: readinessLoading,
    error: readinessError,
    refresh: refreshReadiness,
  } = useBidReadiness(id);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ProcurementDetailSkeleton />
      </div>
    );
  }

  if (!bid || !procurementStatus) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Link
          href="/procurement"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Bids
        </Link>
        <div
          className="mt-8 flex flex-col items-center justify-center py-20 text-center"
          role="alert"
        >
          <AlertCircle
            className="size-10 text-muted-foreground/50"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            Procurement not found
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This bid may have been deleted or you may not have access.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/procurement">Return to Bids</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Back link */}
      <Link
        href="/procurement"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Bids
      </Link>

      {/* Header */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">
              {bid.name}
            </h1>
            <ProcurementWorkflowBadge state={procurementStatus} />
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
          <>
            {/* Desktop actions — hidden on mobile */}
            <div className="hidden items-center gap-2 sm:flex">
              {regularTransitions.filter((t) => t !== 'withdrawn').length >
                0 && (
                <div className="flex items-center gap-1">
                  {regularTransitions
                    .filter((t) => t !== 'withdrawn')
                    .map((transition) => (
                      <Button
                        key={transition}
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusTransition(transition)}
                        disabled={transitioning}
                        aria-label={PROCUREMENT_WORKFLOW_LABELS[transition]}
                      >
                        {transitioning ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : null}
                        {PROCUREMENT_WORKFLOW_LABELS[transition]}
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
              <ReadinessBadge
                readiness={readiness}
                isLoading={readinessLoading}
              />
              <ProcurementExportMenu
                procurementId={id}
                procurementName={bid.name}
                hasQuestions={totalQuestions > 0}
              />
              <Button asChild variant="default" size="sm">
                <Link href={`/procurement/${id}/session`}>
                  <FileText className="mr-1.5 size-4" aria-hidden="true" />
                  Open Session
                </Link>
              </Button>
              {role === 'admin' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" title="More actions">
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                      <span className="sr-only">More actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 size-4" aria-hidden="true" />
                      Delete bid
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Mobile actions — visible on mobile only */}
            <div className="flex items-center gap-2 sm:hidden">
              <Button asChild variant="default" size="sm">
                <Link href={`/procurement/${id}/session`}>
                  <FileText className="mr-1.5 size-4" aria-hidden="true" />
                  Open Session
                </Link>
              </Button>

              <MobileActionMenu
                regularTransitions={regularTransitions}
                transitioning={transitioning}
                isSubmitted={isSubmitted}
                totalQuestions={totalQuestions}
                role={role}
                procurementId={id}
                procurementName={bid.name}
                onStatusTransition={handleStatusTransition}
                onShowOutcomeDialog={() => setShowOutcomeDialog(true)}
                onDelete={handleDelete}
              />
            </div>
          </>
        )}
      </div>

      {/* Extracted metadata prompt */}
      {extractedMetadata && (
        <div className="mt-4 rounded-lg border border-[var(--highlight-border)] bg-[var(--highlight-bg)] p-4">
          <TenderMetadataPrompt
            metadata={extractedMetadata}
            procurementId={id}
            onUpdated={clearExtractedMetadata}
          />
        </div>
      )}

      {/* State stepper */}
      <div className="mt-4">
        <ProcurementWorkflowStepper state={procurementStatus} />
      </div>

      {/* Tabs */}
      <div className="mt-6 border-b">
        <div
          className="flex gap-4"
          role="tablist"
          aria-label="Procurement sections"
          onKeyDown={handleTablistKeyDown}
        >
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
                  activeTab === tab.id
                    ? 'opacity-100 scale-x-100'
                    : 'opacity-0 scale-x-0',
                )}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div
        className="mt-6"
        role="tabpanel"
        id="bid-tabpanel"
        aria-labelledby={`bid-tab-${activeTab}`}
      >
        {activeTab === 'overview' && (
          <OverviewTab
            bid={bid}
            procurementId={id}
            procurementStatus={procurementStatus}
            stats={stats}
            progressPercent={progressPercent}
            completedCount={completedCount}
            totalQuestions={totalQuestions}
            canEdit={canEdit}
            onSwitchTab={setActiveTab}
            onShowOutcomeDialog={() => setShowOutcomeDialog(true)}
            onShowKBReview={() => setShowKBReview(true)}
            readiness={readiness}
            readinessLoading={readinessLoading}
            readinessError={readinessError}
            onRefreshReadiness={refreshReadiness}
          />
        )}
        {activeTab === 'questions' && (
          <>
            {showQuestionReview && extractedQuestions.length > 0 && (
              <div className="mb-6 rounded-lg border bg-card p-4">
                <QuestionReview
                  procurementId={id}
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
                    Find answers for {stats.unmatched_count} questions
                  </Button>
                )}
                {['drafting', 'in_review'].includes(procurementStatus) && (
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5"
                    disabled={draftingAll}
                    onClick={() => setShowCostEstimate(true)}
                  >
                    {draftingAll ? (
                      <Loader2
                        className="size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <PenLine className="size-3.5" aria-hidden="true" />
                    )}
                    {draftingAll ? 'Drafting...' : 'Draft All'}
                  </Button>
                )}
                <CostEstimateDialog
                  open={showCostEstimate}
                  onOpenChange={setShowCostEstimate}
                  procurementId={id}
                  onProceed={handleDraftAll}
                />
              </div>
            )}
            <QuestionList
              procurementId={id}
              questions={questions}
              canEdit={canEdit}
              onQuestionsChanged={() => {
                fetchQuestions();
                fetchProcurement();
              }}
            />
          </>
        )}
        {activeTab === 'documents' && (
          <DocumentsTab
            procurementId={id}
            tenderDocuments={bid.tender_documents ?? []}
            canEdit={canEdit}
            onUploadComplete={handleUploadComplete}
          />
        )}
      </div>

      {/* Outcome dialog (submitted bids) */}
      <ProcurementOutcomeDialog
        open={showOutcomeDialog}
        onOpenChange={setShowOutcomeDialog}
        procurementId={id}
        procurementName={bid.name}
        onOutcomeRecorded={handleOutcomeRecorded}
      />

      {/* KB integration review (after won outcome) */}
      <KBIntegrationReview
        open={showKBReview}
        onOpenChange={setShowKBReview}
        procurementId={id}
        procurementName={bid.name}
        candidates={kbCandidates}
        onIntegrationComplete={handleKBIntegrationComplete}
      />

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bid</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{bid?.name}&rdquo;? This
              cannot be undone.
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

function MobileActionMenu({
  regularTransitions,
  transitioning,
  isSubmitted,
  totalQuestions,
  role,
  procurementId,
  procurementName,
  onStatusTransition,
  onShowOutcomeDialog,
  onDelete,
}: {
  regularTransitions: ProcurementWorkflowState[];
  transitioning: boolean;
  isSubmitted: boolean;
  totalQuestions: number;
  role: string | null;
  procurementId: string;
  procurementName: string;
  onStatusTransition: (state: ProcurementWorkflowState) => void;
  onShowOutcomeDialog: () => void;
  onDelete: () => void;
}) {
  const { exporting, isExporting, handleExport, handlePrint } = useBidExport({
    procurementId,
    procurementName,
  });

  const filteredTransitions = regularTransitions.filter(
    (t) => t !== 'withdrawn',
  );
  const hasTransitions = filteredTransitions.length > 0;
  const hasExport = totalQuestions > 0;
  const hasAnyItems =
    hasTransitions || isSubmitted || hasExport || role === 'admin';

  if (!hasAnyItems) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <MoreHorizontal className="size-4" aria-hidden="true" />
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {/* Status transitions */}
        {filteredTransitions.map((transition) => (
          <DropdownMenuItem
            key={transition}
            onClick={() => onStatusTransition(transition)}
            disabled={transitioning}
          >
            {transitioning && (
              <Loader2
                className="mr-2 size-3.5 animate-spin"
                aria-hidden="true"
              />
            )}
            {PROCUREMENT_WORKFLOW_LABELS[transition]}
          </DropdownMenuItem>
        ))}

        {/* Record Outcome */}
        {isSubmitted && (
          <DropdownMenuItem onClick={onShowOutcomeDialog}>
            Record Outcome
          </DropdownMenuItem>
        )}

        {/* Export sub-menu */}
        {hasExport && (
          <>
            {(hasTransitions || isSubmitted) && <DropdownMenuSeparator />}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={isExporting}>
                {isExporting ? (
                  <Loader2
                    className="mr-2 size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Download className="mr-2 size-4" aria-hidden="true" />
                )}
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() => handleExport('docx')}
                  disabled={isExporting}
                >
                  {exporting === 'docx' ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileText className="size-4" aria-hidden="true" />
                  )}
                  Word (.docx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleExport('xlsx')}
                  disabled={isExporting}
                >
                  {exporting === 'xlsx' ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sheet className="size-4" aria-hidden="true" />
                  )}
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handlePrint} disabled={isExporting}>
                  <Printer className="size-4" aria-hidden="true" />
                  Print / Save as PDF
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}

        {/* Delete — admin only, separated */}
        {role === 'admin' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              Delete bid
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OverviewTab({
  bid,
  procurementId,
  procurementStatus,
  stats,
  progressPercent,
  completedCount,
  totalQuestions,
  canEdit,
  onSwitchTab,
  onShowOutcomeDialog,
  onShowKBReview,
  readiness,
  readinessLoading,
  readinessError,
  onRefreshReadiness,
}: {
  bid: Procurement;
  procurementId: string;
  procurementStatus: ProcurementWorkflowState;
  stats: ProcurementQuestionStats | null;
  progressPercent: number;
  completedCount: number;
  totalQuestions: number;
  canEdit: boolean;
  onSwitchTab: (tab: 'overview' | 'questions' | 'documents') => void;
  onShowOutcomeDialog: () => void;
  onShowKBReview: () => void;
  readiness:
    | import('@/hooks/procurement/use-procurement-readiness').ReadinessData
    | null;
  readinessLoading: boolean;
  readinessError: string | null;
  onRefreshReadiness: () => void;
}) {
  const metadata = bid.domain_metadata as ProcurementMetadata;
  const postureBreakdown = stats
    ? [
        {
          posture: 'strong_match' as ConfidencePosture,
          count: stats.strong_match_count,
        },
        {
          posture: 'partial_match' as ConfidencePosture,
          count: stats.partial_match_count,
        },
        {
          posture: 'needs_sme' as ConfidencePosture,
          count: stats.needs_sme_count,
        },
        {
          posture: 'no_content' as ConfidencePosture,
          count: stats.no_content_count,
        },
      ].filter((p) => p.count > 0)
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Next action prompt — full width */}
      <NextActionCard
        procurementStatus={procurementStatus}
        procurementId={procurementId}
        canEdit={canEdit}
        onShowOutcomeDialog={onShowOutcomeDialog}
        onShowKBReview={onShowKBReview}
      />

      {/* Progress */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Progress</h2>
        {totalQuestions > 0 ? (
          <div className="mt-3 space-y-2">
            <Progress value={progressPercent} className="h-2" />
            <p className="text-sm text-muted-foreground">
              {completedCount} of {totalQuestions} questions drafted (
              {progressPercent}%)
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
            <Upload
              className="size-6 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              No questions extracted yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Questions will be automatically extracted from your tender
              document.
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

      {/* Confidence breakdown */}
      {postureBreakdown.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">
            Confidence Breakdown
          </h2>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {postureBreakdown.map(({ posture, count }) => (
              <ConfidenceDot key={posture} posture={posture} count={count} />
            ))}
          </div>
        </div>
      )}

      {/* Submission readiness — full width */}
      {totalQuestions > 0 && canEdit && (
        <div className="lg:col-span-2">
          <ReadinessChecklist
            readiness={readiness}
            isLoading={readinessLoading}
            error={readinessError}
            onRefresh={onRefreshReadiness}
          />
        </div>
      )}

      {/* Procurement details — spans 2 columns when confidence card is absent to avoid grid asymmetry */}
      {(() => {
        const hasDetails =
          metadata.estimated_value ||
          metadata.reference_number ||
          metadata.deadline ||
          bid.description ||
          metadata.notes;
        return (
          <div
            className={cn(
              'rounded-lg border bg-card p-4',
              postureBreakdown.length === 0 && 'lg:col-span-2',
            )}
          >
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
                    <dd className="font-medium">
                      {formatDateUK(metadata.deadline)}
                    </dd>
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
                <ClipboardList
                  className="size-6 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  No details added yet.
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Add bid details like deadline, estimated value, and reference
                  number to track this opportunity.
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tender documents — upload affordance only (docs tab covers uploaded files) */}
      {(bid.tender_documents?.length ?? 0) === 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">
            Tender Documents
          </h2>
          <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
            <Upload
              className="size-6 text-muted-foreground/50"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              No tender documents uploaded yet.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Upload your tender document to extract questions and start
              drafting responses.
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
        </div>
      )}
    </div>
  );
}

/** State-aware next-action prompt for the Overview tab */
function NextActionCard({
  procurementStatus,
  procurementId,
  canEdit,
  onShowOutcomeDialog,
  onShowKBReview,
}: {
  procurementStatus: ProcurementWorkflowState;
  procurementId: string;
  canEdit: boolean;
  onShowOutcomeDialog: () => void;
  onShowKBReview: () => void;
}) {
  type NextAction = {
    title: string;
    description: string;
    action:
      | { type: 'link'; href: string; label: string }
      | { type: 'button'; onClick: () => void; label: string };
    icon: React.ReactNode;
  };

  function getNextAction(): NextAction | null {
    switch (procurementStatus) {
      case 'draft':
      case 'questions_extracted':
      case 'matching':
      case 'drafting':
        return {
          title: 'Start answering questions',
          description:
            'Open the drafting session to work through your bid responses using the knowledge base.',
          action: {
            type: 'link',
            href: `/procurement/${procurementId}/session`,
            label: 'Open Session',
          },
          icon: <PenLine className="size-5 text-primary" aria-hidden="true" />,
        };
      case 'in_review':
      case 'ready_for_export':
        return {
          title: 'Review responses before submission',
          description:
            'Check your drafted responses for quality and completeness before exporting or submitting.',
          action: {
            type: 'link',
            href: `/procurement/${procurementId}/session`,
            label: 'Review Responses',
          },
          icon: <Eye className="size-5 text-primary" aria-hidden="true" />,
        };
      case 'submitted':
        return {
          title: 'Record the outcome when you hear back',
          description:
            'Once you receive a decision, record whether the bid was won or lost to track your success rate.',
          action: {
            type: 'button',
            onClick: onShowOutcomeDialog,
            label: 'Record Outcome',
          },
          icon: (
            <ClipboardList className="size-5 text-primary" aria-hidden="true" />
          ),
        };
      case 'won':
      case 'lost':
        return {
          title: 'Review responses for your knowledge base',
          description:
            'Identify strong responses worth adding to your knowledge base for future bids.',
          action: {
            type: 'button',
            onClick: onShowKBReview,
            label: 'Review for KB',
          },
          icon: <Award className="size-5 text-primary" aria-hidden="true" />,
        };
      default:
        return null;
    }
  }

  const nextAction = getNextAction();

  if (!nextAction || !canEdit) return null;

  return (
    <div className="lg:col-span-2 rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-4">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          {nextAction.icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            {nextAction.title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {nextAction.description}
          </p>
          {nextAction.action.type === 'link' ? (
            <Button
              asChild
              variant="default"
              size="sm"
              className="mt-3 gap-1.5"
            >
              <Link href={nextAction.action.href}>
                {nextAction.action.label}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={nextAction.action.onClick}
            >
              {nextAction.action.label}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentsTab({
  procurementId,
  tenderDocuments,
  canEdit,
  onUploadComplete,
}: {
  procurementId: string;
  tenderDocuments: TenderDocument[];
  canEdit: boolean;
  onUploadComplete: (result?: ExtractionResult) => void;
}) {
  return (
    <div className="space-y-6">
      {canEdit && (
        <TenderUpload
          procurementId={procurementId}
          onUploadComplete={onUploadComplete}
        />
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
                <FileText
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(doc.size / 1024)} KB
                    {doc.uploaded_at &&
                      ` · Uploaded ${formatDateUK(doc.uploaded_at)}`}
                  </p>
                </div>
                <TenderDownloadLink procurementId={procurementId} doc={doc} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
          <Upload
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            No tender documents uploaded yet.
          </p>
        </div>
      )}
    </div>
  );
}

function TenderDownloadLink({
  procurementId,
  doc,
}: {
  procurementId: string;
  doc: TenderDocument;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(
        `/api/procurement/${procurementId}/tender/download?path=${encodeURIComponent(doc.path)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to get download link');
      }
      const { download_url } = await res.json();
      // Open signed URL in new tab to trigger browser download
      window.open(download_url, '_blank');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50"
      aria-label={`Download ${doc.filename}`}
    >
      {downloading ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <Download className="size-3.5" aria-hidden="true" />
      )}
      Download
    </button>
  );
}

function ProcurementDetailSkeleton() {
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
