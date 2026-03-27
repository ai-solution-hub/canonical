'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  canTransition,
  getAvailableTransitions,
  BID_STATE_LABELS,
} from '@/lib/bid-state-machine';
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
// useBidData — fetching bid and questions, loading state, error handling
// ---------------------------------------------------------------------------

function useBidData(id: string) {
  const router = useRouter();

  const [bid, setBid] = useState<Bid | null>(null);
  const [questions, setQuestions] = useState<BidQuestion[]>([]);
  const [stats, setStats] = useState<BidQuestionStats | null>(null);
  const [loading, setLoading] = useState(true);

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
    } catch (err) {
      console.error('Failed to load bid:', err);
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
    } catch (err) {
      console.error('Failed to fetch bid questions:', err);
      // Non-critical, questions tab still shows empty
    }
  }, [id]);

  // Initial data load
  useEffect(() => {
    fetchBid();
    fetchQuestions();
  }, [fetchBid, fetchQuestions]);

  return {
    bid,
    questions,
    stats,
    loading,
    fetchBid,
    fetchQuestions,
  };
}

// ---------------------------------------------------------------------------
// useBidTransitions — status transition handlers
// ---------------------------------------------------------------------------

function useBidTransitions(
  bid: Bid | null,
  id: string,
  fetchBid: () => Promise<void>,
) {
  const [transitioning, setTransitioning] = useState(false);

  async function handleStatusTransition(newStatus: BidState) {
    if (!bid) return;
    const currentStatus = bid.status as BidState;
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

  return {
    transitioning,
    handleStatusTransition,
  };
}

// ---------------------------------------------------------------------------
// useBidDialogs — dialog open/close state
// ---------------------------------------------------------------------------

function useBidDialogs() {
  const [showCostEstimate, setShowCostEstimate] = useState(false);
  const [showOutcomeDialog, setShowOutcomeDialog] = useState(false);
  const [showKBReview, setShowKBReview] = useState(false);
  const [kbCandidates, setKBCandidates] = useState<KBCandidate[]>([]);
  const [extractedMetadata, setExtractedMetadata] = useState<TenderExtractedMetadata | null>(null);
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
  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestion[]>([]);

  function handleUploadComplete(result?: ExtractionResult) {
    fetchBid();
    fetchQuestions();
    // Check for extracted metadata
    const resultAny = result as unknown as Record<string, unknown>;
    if (resultAny?.extracted_metadata) {
      setExtractedMetadata(resultAny.extracted_metadata as TenderExtractedMetadata);
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

  // Data fetching
  const {
    bid,
    questions,
    stats,
    loading,
    fetchBid,
    fetchQuestions,
  } = useBidData(id);

  // Tab state (kept here as it bridges data and extraction concerns)
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Status transitions
  const {
    transitioning,
    handleStatusTransition,
  } = useBidTransitions(bid, id, fetchBid);

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
  } = useQuestionExtraction(id, fetchBid, fetchQuestions, setActiveTab, setExtractedMetadata);

  // Drafting state (lives here as it uses dialog + data concerns)
  const [draftingAll, setDraftingAll] = useState(false);

  // Handlers that coordinate across concerns

  function handleDelete() {
    setDeleteConfirmOpen(true);
  }

  async function handleDeleteConfirmed() {
    setDeleteConfirmOpen(false);
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

  function clearExtractedMetadata() {
    setExtractedMetadata(null);
    fetchBid();
  }

  function handleKBIntegrationComplete(result: { created: number; updated: number }) {
    setShowKBReview(false);
    setKBCandidates([]);
    fetchBid();
    toast.success(
      `KB integration complete: ${result.created} created, ${result.updated} updated`,
    );
  }

  // Computed values
  const metadata = bid ? (bid.domain_metadata as BidMetadata) : null;
  const bidStatus = bid
    ? ((bid.status ?? 'draft') as BidState)
    : null;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount = (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent = totalQuestions > 0 ? Math.round((completedCount / totalQuestions) * 100) : 0;
  const availableTransitions = bidStatus ? getAvailableTransitions(bidStatus) : [];
  const outcomeTransitions = ['won', 'lost', 'withdrawn'] as const;
  const isSubmitted = bidStatus === 'submitted';
  const regularTransitions = availableTransitions.filter(
    t => !isSubmitted || !outcomeTransitions.includes(t as typeof outcomeTransitions[number]),
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'questions', label: 'Questions', count: totalQuestions },
    { id: 'responses', label: 'Responses' },
    { id: 'documents', label: 'Documents', count: metadata?.tender_document_ids?.length ?? 0 },
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
    draftingAll,
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
