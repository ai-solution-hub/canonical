'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import {
  canTransition,
  getAvailableTransitions,
  BID_STATE_LABELS,
} from '@/lib/bid/bid-state-machine';
import type {
  Bid,
  BidMetadata,
  BidQuestion,
  BidQuestionStats,
  BidState,
  ExtractionResult,
  KBCandidate,
} from '@/types/bid';
import type { TenderExtractedMetadata } from '@/types/bid-metadata';

type Tab = 'overview' | 'questions' | 'responses' | 'documents';

interface ExtractedQuestion {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  category: string;
}

interface UseBidActionsParams {
  id: string;
}

// ---------------------------------------------------------------------------
// useBidData — TanStack Query-based bid and questions fetching
// ---------------------------------------------------------------------------

function useBidData(id: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // The queryFn deliberately does NOT close over `router` — putting an
  // unstable function reference in the query closure forces it into the
  // queryKey deps under @tanstack/query/exhaustive-deps. Instead the
  // queryFn returns a sentinel on 404 and the navigation is performed in
  // a side-effect hook below.
  const bidQuery = useQuery({
    queryKey: queryKeys.bids.detail(id),
    queryFn: async () => {
      const response = await fetch(`/api/bids/${id}`);
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
    if (!bidQuery.isLoading && bidQuery.isSuccess && bidQuery.data === null) {
      toast.error('Bid not found');
      router.push('/bid');
    }
  }, [bidQuery.isLoading, bidQuery.isSuccess, bidQuery.data, router]);

  const questionsQuery = useQuery({
    queryKey: queryKeys.bids.questions(id),
    queryFn: async () => {
      const response = await fetch(`/api/bids/${id}/questions`);
      if (!response.ok) throw new Error('Failed to fetch questions');
      return response.json();
    },
  });

  const { refetch: refetchBid } = bidQuery;
  const { refetch: refetchQuestions } = questionsQuery;

  const fetchBid = useCallback(async () => {
    await refetchBid();
  }, [refetchBid]);

  const fetchQuestions = useCallback(async () => {
    await refetchQuestions();
  }, [refetchQuestions]);

  return {
    bid: bidQuery.data ?? null,
    questions: questionsQuery.data?.questions ?? [],
    stats: questionsQuery.data?.stats ?? bidQuery.data?.question_stats ?? null,
    loading: bidQuery.isLoading,
    fetchBid,
    fetchQuestions,
    queryClient,
  };
}

// ---------------------------------------------------------------------------
// useBidTransitions — status transition via useMutation
// ---------------------------------------------------------------------------

function useBidTransitions(
  bid: Bid | null,
  id: string,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  const transitionMutation = useMutation({
    mutationFn: async (newStatus: BidState) => {
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

      return newStatus;
    },
    onSuccess: (newStatus: BidState) => {
      toast.success(`Bid moved to ${BID_STATE_LABELS[newStatus]}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update status');
    },
  });

  const { mutate: transitionMutate } = transitionMutation;

  const handleStatusTransition = useCallback(
    async (newStatus: BidState) => {
      if (!bid) return;
      const currentStatus = bid.status as BidState;
      if (!canTransition(currentStatus, newStatus)) {
        toast.error(
          `Cannot transition from ${BID_STATE_LABELS[currentStatus]} to ${BID_STATE_LABELS[newStatus]}`,
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
// useBidDialogs — dialog open/close state (pure UI state, no changes)
// ---------------------------------------------------------------------------

function useBidDialogs() {
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
  fetchBid: () => Promise<void>,
  fetchQuestions: () => Promise<void>,
  setActiveTab: (tab: Tab) => void,
  setExtractedMetadata: (metadata: TenderExtractedMetadata | null) => void,
) {
  const [showQuestionReview, setShowQuestionReview] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<
    ExtractedQuestion[]
  >([]);

  function handleUploadComplete(result?: ExtractionResult) {
    fetchBid();
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
    fetchBid();
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
// useBidActions — composes the sub-hooks, preserving the original API
// ---------------------------------------------------------------------------

export function useBidActions({ id }: UseBidActionsParams) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Data fetching (TanStack Query)
  const { bid, questions, stats, loading, fetchBid, fetchQuestions } =
    useBidData(id);

  // Tab state (kept here as it bridges data and extraction concerns)
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Status transitions (useMutation)
  const { transitioning, handleStatusTransition } = useBidTransitions(
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
  } = useBidDialogs();

  // Question extraction flow
  const {
    showQuestionReview,
    extractedQuestions,
    handleUploadComplete,
    handleQuestionReviewConfirmed,
    handleQuestionReviewCancelled,
  } = useQuestionExtraction(
    id,
    fetchBid,
    fetchQuestions,
    setActiveTab,
    setExtractedMetadata,
  );

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/bids/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete bid');
      }
    },
    onSuccess: () => {
      toast.success('Bid deleted');
      router.push('/bid');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete bid');
    },
  });

  // Match questions mutation
  const matchMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/bids/${id}/questions/match`, {
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

  // Draft all mutation
  const draftAllMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/bids/${id}/responses/draft-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skip_existing: true }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to draft responses');
      }

      return response.json();
    },
    onSuccess: (result: {
      drafted: number;
      skipped: number;
      failed: number;
      total_cost: number;
    }) => {
      const { drafted, skipped, failed } = result;

      if (failed > 0) {
        toast.warning(
          `Drafted ${drafted} responses, ${failed} failed, ${skipped} skipped`,
        );
      } else {
        toast.success(`Drafted ${drafted} responses (${skipped} skipped)`);
      }

      if (result.total_cost > 0) {
        toast.info(`Total cost: $${result.total_cost.toFixed(4)}`);
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.bids.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.questions(id) });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to draft responses');
    },
  });

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
  const metadata = bid ? (bid.domain_metadata as BidMetadata) : null;
  const bidStatus = bid ? ((bid.status ?? 'draft') as BidState) : null;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount =
    (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent =
    totalQuestions > 0
      ? Math.round((completedCount / totalQuestions) * 100)
      : 0;
  const availableTransitions = bidStatus
    ? getAvailableTransitions(bidStatus)
    : [];
  const outcomeTransitions = ['won', 'lost', 'withdrawn'] as const;
  const isSubmitted = bidStatus === 'submitted';
  const regularTransitions = availableTransitions.filter(
    (t) =>
      !isSubmitted ||
      !outcomeTransitions.includes(t as (typeof outcomeTransitions)[number]),
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'questions', label: 'Questions', count: totalQuestions },
    { id: 'responses', label: 'Responses' },
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
    draftingAll: draftAllMutation.isPending,
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
    fetchBid,
    fetchQuestions,

    // Computed
    metadata,
    bidStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    availableTransitions,
    isSubmitted,
    regularTransitions,
    tabs,
  };
}

export type { Tab, ExtractedQuestion };
