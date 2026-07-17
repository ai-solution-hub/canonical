'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { handleTablistKeyDown } from '@/lib/tablist-keyboard';
import Link from 'next/link';
import {
  ArrowRight,
  Award,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Upload,
  Trash2,
  Loader2,
  PenLine,
  MoreHorizontal,
  Sheet,
  Printer,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { ItemPageFrame } from '@/components/procurement/item-page-frame';
import { ItemDocumentsTab } from '@/components/procurement/item-documents-tab';
import { ItemWorkflowPanel } from '@/components/procurement/item-workflow-panel';
import { ItemInlineStates } from '@/components/procurement/item-inline-states';
import { ItemQuestionsPanel } from '@/components/procurement/item-questions-panel';
import { ItemCoveragePanel } from '@/components/procurement/item-coverage-panel';
import { ItemGroupingRail } from '@/components/procurement/item-grouping-rail';
import { ItemFillSlotReview } from '@/components/procurement/item-fill-slot-review';
import { ItemCitationOverlay } from '@/components/procurement/item-citation-overlay';
import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';
import { ProcurementExportMenu } from '@/components/procurement/procurement-export-menu';
import { ReadinessBadge } from '@/components/procurement/readiness-checklist';
import { CostEstimateDialog } from '@/components/coverage/cost-estimate-dialog';
import { ProcurementOutcomeDialog } from '@/components/procurement/procurement-outcome';
import { KBIntegrationReview } from '@/components/procurement/kb-integration-review';
import { QuestionReview } from '@/components/procurement/question-review';
import { TenderMetadataPrompt } from '@/components/procurement/tender-metadata-prompt';
import { useUserRole } from '@/hooks/use-user-role';
import { useFormActions } from '@/hooks/procurement/use-procurement-actions';
import { useProcurementExport } from '@/hooks/procurement/use-procurement-export';
import { useProcurementReadiness } from '@/hooks/procurement/use-procurement-readiness';
import type { ReadinessData } from '@/hooks/procurement/use-procurement-readiness';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/domains/procurement/procurement-helpers';
import {
  deriveEngagementGroupId,
  deriveEngagementSiblings,
  deriveFormSourceAttachments,
  deriveReferenceEvidenceAttachments,
} from '@/lib/domains/procurement/procurement-detail-shape';
import { PROCUREMENT_WORKFLOW_LABELS } from '@/lib/domains/procurement/procurement-workflow';
import { cn } from '@/lib/utils';
import type {
  Procurement,
  ProcurementMetadata,
  ProcurementQuestionStats,
  ProcurementWorkflowState,
} from '@/types/procurement';

// ID-145 {145.42} (145W-2, PLAN.md Wave 3) — the §A hybrid frame (DR-068):
// a custom domain-shaped frame (header + optional engagement rail +
// Documents tab), NOT Extend's Finder. This subtask ALSO establishes the
// child-component structure — `ItemWorkflowPanel`, `ItemInlineStates`,
// `ItemQuestionsPanel`, `ItemCoveragePanel`, `ItemGroupingRail`,
// `ItemFillSlotReview`, `ItemCitationOverlay` — that {145.43}/{145.44}/
// {145.45}/{145.47} fill in parallel WITHOUT re-touching this file (each is
// currently a minimal placeholder — see each component's own file header).
// The action toolbar (transitions/export/delete/outcome/KB-review), the
// question-review banner + cost-estimate dialog, and the Overview tab's
// NextActionCard/Details/tender-documents-prompt are unchanged page-level
// chrome, not claimed by any of those five subtasks.
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
    notFoundConfirmed,
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
  } = useProcurementReadiness(id);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ItemInlineStates variant="loading" />
      </div>
    );
  }

  // ID-145 {145.18} BI-2/BI-3 — the item IS the form, addressed by its form
  // id. An unknown/retired id resolves to the standard not-found surface via
  // Next's notFound() (renders app/procurement/[id]/not-found.tsx) — NO
  // legacy redirect, no primary-form lookup, no workspace->form mapping.
  if (notFoundConfirmed) {
    notFound();
  }

  if (!bid || !procurementStatus) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <ItemInlineStates variant="error" />
      </div>
    );
  }

  // ID-145 {145.42} — TECH §6 group-A GET ADD: §A3 engagement gate + §A5
  // role-split attachments, folded into the SAME `bid` (detail GET) response.
  const engagementGroupId = deriveEngagementGroupId(bid);
  const engagementSiblings = deriveEngagementSiblings(bid);
  const formSourceAttachments = deriveFormSourceAttachments(bid);
  const referenceEvidenceAttachments = deriveReferenceEvidenceAttachments(bid);

  const deadlineProximity = metadata?.deadline
    ? getDeadlineProximity(metadata.deadline)
    : null;

  return (
    <ItemPageFrame
      backHref="/procurement"
      name={bid.name}
      stateBadge={<ProcurementWorkflowBadge state={procurementStatus} />}
      issuingOrganisation={metadata?.buyer || null}
      deadlineLabel={
        metadata?.deadline ? formatDateUK(metadata.deadline) : null
      }
      deadlineProximityBadge={
        deadlineProximity && (
          <span
            className={cn(
              'ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              deadlineProximity.isOverdue
                ? 'bg-form-overdue-bg text-form-overdue border border-form-overdue-border'
                : 'bg-status-warning/10 text-status-warning',
            )}
          >
            {deadlineProximity.label}
          </span>
        )
      }
      referenceNumber={metadata?.reference_number ?? null}
      estimatedValue={metadata?.estimated_value ?? null}
      groupingRail={
        engagementGroupId ? (
          <ItemGroupingRail
            engagementGroupId={engagementGroupId}
            currentFormId={id}
            siblings={engagementSiblings}
          />
        ) : undefined
      }
      actions={
        canEdit && (
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
        )
      }
    >
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

      {/* Workflow panel (§G stepper host — {145.43} fills) */}
      <div className="mt-4">
        <ItemWorkflowPanel
          workflowState={procurementStatus}
          deadline={metadata?.deadline ?? null}
          submissionDate={metadata?.submission_date ?? null}
          issuingOrganisation={metadata?.buyer ?? null}
          outcome={metadata?.outcome ?? null}
          canEdit={canEdit}
          onTransition={handleStatusTransition}
          transitioning={transitioning}
        />
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
              id={`procurement-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="procurement-tabpanel"
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
        id="procurement-tabpanel"
        aria-labelledby={`procurement-tab-${activeTab}`}
      >
        {activeTab === 'overview' && (
          <OverviewTab
            bid={bid}
            metadata={metadata}
            procurementId={id}
            procurementStatus={procurementStatus}
            stats={stats}
            totalQuestions={totalQuestions}
            completedCount={completedCount}
            progressPercent={progressPercent}
            canEdit={canEdit}
            readiness={readiness}
            readinessLoading={readinessLoading}
            readinessError={readinessError}
            onRefreshReadiness={refreshReadiness}
            onSwitchTab={setActiveTab}
            onShowOutcomeDialog={() => setShowOutcomeDialog(true)}
            onShowKBReview={() => setShowKBReview(true)}
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
            <ItemQuestionsPanel
              procurementId={id}
              questions={questions}
              canEdit={canEdit}
              totalQuestions={totalQuestions}
              unmatchedCount={stats?.unmatched_count}
              onMatchQuestions={handleMatchQuestions}
              onDraftAll={handleDraftAll}
              draftingAll={draftingAll}
              onQuestionsChanged={() => {
                fetchQuestions();
                fetchProcurement();
              }}
            />
            <CostEstimateDialog
              open={showCostEstimate}
              onOpenChange={setShowCostEstimate}
              procurementId={id}
              onProceed={handleDraftAll}
            />
            {/* {145.47} — fill-slot review + citation overlay pair with the
                question/drafting surfaces (both PDF-only, DR-064). */}
            <div className="mt-4 space-y-4">
              <ItemFillSlotReview formId={id} />
              <ItemCitationOverlay formId={id} />
            </div>
          </>
        )}
        {activeTab === 'documents' && (
          <ItemDocumentsTab
            procurementId={id}
            tenderDocuments={bid.tender_documents ?? []}
            formSourceAttachments={formSourceAttachments}
            referenceEvidenceAttachments={referenceEvidenceAttachments}
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
    </ItemPageFrame>
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
  const { exporting, isExporting, handleExport, handlePrint } =
    useProcurementExport({
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
  metadata,
  procurementId,
  procurementStatus,
  stats,
  totalQuestions,
  completedCount,
  progressPercent,
  canEdit,
  readiness,
  readinessLoading,
  readinessError,
  onRefreshReadiness,
  onSwitchTab,
  onShowOutcomeDialog,
  onShowKBReview,
}: {
  bid: Procurement;
  metadata: ProcurementMetadata | null;
  procurementId: string;
  procurementStatus: ProcurementWorkflowState;
  stats: ProcurementQuestionStats | null;
  totalQuestions: number;
  completedCount: number;
  progressPercent: number;
  canEdit: boolean;
  readiness: ReadinessData | null;
  readinessLoading: boolean;
  readinessError: string | null;
  onRefreshReadiness: () => void;
  onSwitchTab: (tab: 'overview' | 'questions' | 'documents') => void;
  onShowOutcomeDialog: () => void;
  onShowKBReview: () => void;
}) {
  // ID-145 {145.18} re-point: `metadata` is derived directly off the flat
  // form_instances response by the hook (BI-1 — no `domain_metadata` read)
  // and passed in as a prop.
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

      {/* Coverage (progress/confidence/readiness) — {145.44} fills */}
      <div className="lg:col-span-2">
        <ItemCoveragePanel
          procurementId={procurementId}
          stats={stats}
          totalQuestions={totalQuestions}
          completedCount={completedCount}
          progressPercent={progressPercent}
          canEdit={canEdit}
          readiness={readiness}
          readinessLoading={readinessLoading}
          readinessError={readinessError}
          onRefreshReadiness={onRefreshReadiness}
        />
      </div>

      {/* Procurement details — full width now the confidence card moved into
          ItemCoveragePanel (avoids grid asymmetry). */}
      <div className="rounded-lg border bg-card p-4 lg:col-span-2">
        <h2 className="text-sm font-medium text-foreground">Details</h2>
        {metadata?.estimated_value ||
        metadata?.reference_number ||
        metadata?.deadline ||
        bid.description ||
        metadata?.notes ? (
          <dl className="mt-3 space-y-2 text-sm">
            {metadata?.estimated_value && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Estimated Value</dt>
                <dd className="font-medium">{metadata.estimated_value}</dd>
              </div>
            )}
            {metadata?.reference_number && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-medium">{metadata.reference_number}</dd>
              </div>
            )}
            {metadata?.deadline && (
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
            {metadata?.notes && (
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
