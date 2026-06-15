'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import {
  canTransition,
  getAvailableTransitions,
  PROCUREMENT_WORKFLOW_LABELS,
} from '@/lib/procurement/procurement-workflow';
import type {
  Procurement,
  ProcurementMetadata,
  ProcurementWorkflowState,
  ExtractionResult,
  KBCandidate,
} from '@/types/procurement';
import type { TenderExtractedMetadata } from '@/types/procurement-metadata';

type Tab = 'overview' | 'questions' | 'documents';

const VALID_TABS: readonly Tab[] = ['overview', 'questions', 'documents'];

function isValidTab(value: string | null): value is Tab {
  return value !== null && VALID_TABS.includes(value as Tab);
}

interface ExtractedQuestion {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  category: string;
}

interface UseFormActionsParams {
  id: string;
}

// ---------------------------------------------------------------------------
// useFormData — TanStack Query-based form and questions fetching
// ---------------------------------------------------------------------------

function useFormData(id: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // The queryFn deliberately does NOT close over `router` — putting an
  // unstable function reference in the query closure forces it into the
  // queryKey deps under @tanstack/query/exhaustive-deps. Instead the
  // queryFn returns a sentinel on 404 and the navigation is performed in
  // a side-effect hook below.
  const procurementQuery = useQuery({
    queryKey: queryKeys.bids.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/procurement/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to fetch bid');
      }
      return response.json();
    },
  });

  // Redirect on confirmed 404 (queryFn returned null without throwing).
  useEffect(() => {
    if (
      !procurementQuery.isLoading &&
      procurementQuery.isSuccess &&
      procurementQuery.data === null
    ) {
      toast.error('Procurement not found');
      router.push('/procurement');
    }
  }, [
    procurementQuery.isLoading,
    procurementQuery.isSuccess,
    procurementQuery.data,
    router,
  ]);

  const questionsQuery = useQuery({
    queryKey: queryKeys.bids.questions(id),
    queryFn: async () => {
      const response = await fetch(`/api/procurement/${id}/questions`);
      if (!response.ok) throw new Error('Failed to fetch questions');
      return response.json();
    },
  });

  const { refetch: refetchBid } = procurementQuery;
  const { refetch: refetchQuestions } = questionsQuery;

  const fetchProcurement = useCallback(async () => {
    await refetchBid();
  }, [refetchBid]);

  const fetchQuestions = useCallback(async () => {
    await refetchQuestions();
  }, [refetchQuestions]);

  return {
    bid: procurementQuery.data ?? null,
    questions: questionsQuery.data?.questions ?? [],
    stats:
      questionsQuery.data?.stats ??
      procurementQuery.data?.question_stats ??
      null,
    loading: procurementQuery.isLoading,
    fetchProcurement,
    fetchQuestions,
    queryClient,
  };
}

// ---------------------------------------------------------------------------
// useFormTransitions — status transition via useMutation
// ---------------------------------------------------------------------------

function useFormTransitions(
  bid: Procurement | null,
  id: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const transitionMutation = useMutation({
    mutationFn: async (newStatus: ProcurementWorkflowState) => {
      const body: Record<string, string> = { status: newStatus };
      if (newStatus === 'submitted') {
        body.submission_date = new Date().toISOString();
      }

      const response = await fetch(`/api/procurement/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update status');
      }

      return newStatus;
    },
    onSuccess: (newStatus: ProcurementWorkflowState) => {
      toast.success(
        `Procurement moved to ${PROCUREMENT_WORKFLOW_LABELS[newStatus]}`,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update status');
    },
  });

  const { mutate: transitionMutate } = transitionMutation;

  const handleStatusTransition = useCallback(
    async (newStatus: ProcurementWorkflowState) => {
      if (!bid) return;
      const currentStatus = bid.status as ProcurementWorkflowState;
      if (!canTransition(currentStatus, newStatus)) {
        toast.error(
          `Cannot transition from ${PROCUREMENT_WORKFLOW_LABELS[currentStatus]} to ${PROCUREMENT_WORKFLOW_LABELS[newStatus]}`,
        );
        return;
      }
      transitionMutate(newStatus);
    },
    [bid, transitionMutate],
  );

  return {
    transitioning: transitionMutation.isPending,
    handleStatusTransition,
  };
}

// ---------------------------------------------------------------------------
// useFormDialogs — dialog open/close state (pure UI state, no changes)
// ---------------------------------------------------------------------------

function useFormDialogs() {
  const [showCostEstimate, setShowCostEstimate] = useState(false);
  const [showOutcomeDialog, setShowOutcomeDialog] = useState(false);
  const [showKBReview, setShowKBReview] = useState(false);
  const [kbCandidates, setKBCandidates] = useState<KBCandidate[]>([]);
  const [extractedMetadata, setExtractedMetadata] =
    useState<TenderExtractedMetadata | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  return {
    showCostEstimate,
    setShowCostEstimate,
    showOutcomeDialog,
    setShowOutcomeDialog,
    showKBReview,
    setShowKBReview,
    kbCandidates,
    setKBCandidates,
    extractedMetadata,
    setExtractedMetadata,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  };
}

// ---------------------------------------------------------------------------
// useQuestionExtraction — upload, extraction, question review flow
// ---------------------------------------------------------------------------

function useQuestionExtraction(
  id: string,
  fetchProcurement: () => Promise<void>,
  fetchQuestions: () => Promise<void>,
  setActiveTab: (tab: Tab) => void,
  setExtractedMetadata: (metadata: TenderExtractedMetadata | null) => void,
) {
  const [showQuestionReview, setShowQuestionReview] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<
    ExtractedQuestion[]
  >([]);

  function handleUploadComplete(result?: ExtractionResult) {
    fetchProcurement();
    fetchQuestions();
    // Check for extracted metadata
    const resultAny = result as unknown as Record<string, unknown>;
    if (resultAny?.extracted_metadata) {
      setExtractedMetadata(
        resultAny.extracted_metadata as TenderExtractedMetadata,
      );
    }
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
    fetchProcurement();
  }

  function handleQuestionReviewCancelled() {
    setShowQuestionReview(false);
    setExtractedQuestions([]);
  }

  return {
    showQuestionReview,
    extractedQuestions,
    handleUploadComplete,
    handleQuestionReviewConfirmed,
    handleQuestionReviewCancelled,
  };
}

// ---------------------------------------------------------------------------
// useFormActions — composes the sub-hooks, preserving the original API
// ---------------------------------------------------------------------------

export function useFormActions({ id }: UseFormActionsParams) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Data fetching (TanStack Query)
  const { bid, questions, stats, loading, fetchProcurement, fetchQuestions } =
    useFormData(id);

  // Tab state — derived from URL ?tab= param for deep-link and refresh support
  const searchString = searchParams.toString();
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = useMemo(
    () => (isValidTab(tabParam) ? tabParam : 'overview'),
    [tabParam],
  );

  const setActiveTab = useCallback(
    (tab: Tab) => {
      const params = new URLSearchParams(searchString);
      if (tab === 'overview') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const search = params.toString();
      const newPath = search ? `${pathname}?${search}` : pathname;
      router.replace(newPath);
    },
    [searchString, pathname, router],
  );

  // Status transitions (useMutation)
  const { transitioning, handleStatusTransition } = useFormTransitions(
    bid,
    id,
    queryClient,
  );

  // Dialog state
  const {
    showCostEstimate,
    setShowCostEstimate,
    showOutcomeDialog,
    setShowOutcomeDialog,
    showKBReview,
    setShowKBReview,
    kbCandidates,
    setKBCandidates,
    extractedMetadata,
    setExtractedMetadata,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  } = useFormDialogs();

  // Question extraction flow
  const {
    showQuestionReview,
    extractedQuestions,
    handleUploadComplete,
    handleQuestionReviewConfirmed,
    handleQuestionReviewCancelled,
  } = useQuestionExtraction(
    id,
    fetchProcurement,
    fetchQuestions,
    setActiveTab,
    setExtractedMetadata,
  );

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/procurement/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete bid');
      }
    },
    onSuccess: () => {
      toast.success('Procurement deleted');
      router.push('/procurement');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete bid');
    },
  });

  // Match questions mutation
  const matchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/procurement/${id}/questions/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to match questions');
      }

      return response.json();
    },
    onSuccess: (result: { matched: number }) => {
      toast.success(`Matched ${result.matched} questions against KB`);
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.questions(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to match questions');
    },
  });

  // ---------------------------------------------------------------------
  // Draft all mutation — post-S224 §5.4.1 D-4 ratification.
  //
  // The route now enqueues a `bid_draft_all` job and returns HTTP 202 with
  // `{ job_id, pipeline_run_id, status: 'queued', deduplicated }`. We poll
  // `/api/jobs/:job_id/status` every 3s (matches existing template-fill
  // polling pattern at `components/bid/template-fill-progress.tsx:16`) and
  // surface the terminal state via toast.
  //
  // `activeJobId` drives the polled `useQuery` below — set in `onSuccess`
  // and cleared when the job reaches a terminal status. While polling is
  // active OR the mutation is pending, `draftingAll` is `true` and the UI
  // disables the button.
  // ---------------------------------------------------------------------
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const draftAllMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/procurement/${id}/responses/draft-all`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skip_existing: true }),
        },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to draft responses');
      }

      return response.json() as Promise<{
        job_id: string;
        pipeline_run_id: string;
        status: 'queued';
        deduplicated: boolean;
      }>;
    },
    onSuccess: (result) => {
      setActiveJobId(result.job_id);
      if (result.deduplicated) {
        toast.info('Already drafting — using existing job…');
      } else {
        toast.success(
          "Drafting all responses queued — we'll let you know when it's done.",
        );
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to draft responses');
    },
  });

  // Polled job-status query — refetches every 3s while `activeJobId` is
  // non-null. Settles when `data.status` is terminal (`completed |
  // completed_with_errors | failed | cancelled | dead_lettered`).
  const draftAllJobStatus = useQuery({
    queryKey: queryKeys.jobs.status(activeJobId ?? ''),
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${activeJobId}/status`);
      if (!res.ok) throw new Error('Failed to fetch job status');
      return res.json() as Promise<{
        id: string;
        job_type: string;
        status:
          | 'pending'
          | 'processing'
          | 'completed'
          | 'failed'
          | 'cancelled'
          | 'dead_lettered';
        result: {
          drafted?: number;
          skipped?: number;
          failed?: number;
          total_cost?: number;
        } | null;
        error_message: string | null;
      }>;
    },
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'dead_lettered'
      ) {
        return false;
      }
      return 3000;
    },
  });

  // React to terminal status — show toast, invalidate queries, clear
  // `activeJobId` so the polling stops cleanly.
  const draftAllJobStatusData = draftAllJobStatus.data;
  useEffect(() => {
    if (!activeJobId || !draftAllJobStatusData) return;
    const { status, result, error_message } = draftAllJobStatusData;
    if (status === 'completed') {
      const drafted = result?.drafted ?? 0;
      const skipped = result?.skipped ?? 0;
      const failed = result?.failed ?? 0;
      const totalCost = result?.total_cost ?? 0;
      if (failed > 0) {
        toast.warning(
          `Drafted ${drafted} responses, ${failed} failed, ${skipped} skipped`,
        );
      } else {
        toast.success(`Drafted ${drafted} responses (${skipped} skipped)`);
      }
      if (totalCost > 0) {
        toast.info(`Total cost: $${totalCost.toFixed(4)}`);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.bids.questions(id),
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing polling key in response to async terminal job status from useQuery
      setActiveJobId(null);
    } else if (status === 'failed' || status === 'dead_lettered') {
      toast.error(error_message ?? 'Drafting failed');
      setActiveJobId(null);
    } else if (status === 'cancelled') {
      toast.info('Drafting cancelled');
      setActiveJobId(null);
    }
  }, [activeJobId, draftAllJobStatusData, id, queryClient]);

  // Handlers that coordinate across concerns

  function handleDelete() {
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirmed() {
    setDeleteConfirmOpen(false);
    deleteMutation.mutate();
  }

  async function handleMatchQuestions() {
    matchMutation.mutate();
  }

  async function handleDraftAll() {
    draftAllMutation.mutate();
  }

  function handleOutcomeRecorded(outcome: string, candidates: KBCandidate[]) {
    setShowOutcomeDialog(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
    if (candidates.length > 0) {
      setKBCandidates(candidates);
      setShowKBReview(true);
    }
  }

  function clearExtractedMetadata() {
    setExtractedMetadata(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
  }

  function handleKBIntegrationComplete(result: {
    created: number;
    updated: number;
  }) {
    setShowKBReview(false);
    setKBCandidates([]);
    queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
    toast.success(
      `KB integration complete: ${result.created} created, ${result.updated} updated`,
    );
  }

  // Computed values
  const metadata = bid ? (bid.domain_metadata as ProcurementMetadata) : null;
  const procurementStatus = bid
    ? ((bid.status ?? 'draft') as ProcurementWorkflowState)
    : null;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount =
    (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent =
    totalQuestions > 0
      ? Math.round((completedCount / totalQuestions) * 100)
      : 0;
  const availableTransitions = procurementStatus
    ? getAvailableTransitions(procurementStatus)
    : [];
  const outcomeTransitions = ['won', 'lost', 'withdrawn'] as const;
  const isSubmitted = procurementStatus === 'submitted';
  const regularTransitions = availableTransitions.filter(
    (t) =>
      !isSubmitted ||
      !outcomeTransitions.includes(t as (typeof outcomeTransitions)[number]),
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'questions', label: 'Questions', count: totalQuestions },
    {
      id: 'documents',
      label: 'Documents',
      count: metadata?.tender_document_ids?.length ?? 0,
    },
  ];

  return {
    // Core state
    bid,
    questions,
    stats,
    loading,
    activeTab,
    setActiveTab,

    // Transition state
    transitioning,

    // Question review state
    showQuestionReview,
    extractedQuestions,

    // UI dialog state
    showCostEstimate,
    setShowCostEstimate,
    draftingAll: draftAllMutation.isPending || activeJobId !== null,
    showOutcomeDialog,
    setShowOutcomeDialog,
    showKBReview,
    setShowKBReview,
    kbCandidates,
    extractedMetadata,

    // Delete confirmation
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    handleDeleteConfirmed,

    // Handlers
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

    // Data refresh
    fetchProcurement,
    fetchQuestions,

    // Computed
    metadata,
    procurementStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    availableTransitions,
    isSubmitted,
    regularTransitions,
    tabs,
  };
}

export type { Tab };
