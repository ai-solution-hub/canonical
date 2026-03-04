'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useCopilotReadable } from '@copilotkit/react-core';
import { useUserRole } from '@/hooks/use-user-role';
import type { BidMetadata, BidQuestion, ConfidencePosture } from '@/types/bid';

// ────────────────────────────────────────────
// Context value types
// ────────────────────────────────────────────

interface BidSummary {
  id: string;
  name: string;
  buyer: string | null;
  deadline: string | null;
  status: string;
  totalQuestions: number;
  draftedCount: number;
  reviewedCount: number;
  acceptedCount: number;
}

export interface QuestionSummary {
  id: string;
  questionNumber: number;
  questionText: string;
  section: string | null;
  wordLimit: number | null;
  confidencePosture: string;
  responseStatus: string | null;
}

interface ResponseSummary {
  id: string;
  responseText: string;
  wordCount: number;
  reviewStatus: string;
  sourceContentIds: string[];
  qualityScore: number | null;
}

interface BidContextValue {
  bidId: string;
  bid: BidSummary | null;
  questions: QuestionSummary[];
  activeQuestionId: string | null;
  activeResponse: ResponseSummary | null;
  setActiveQuestionId: (id: string | null) => void;
  editorRef: React.RefObject<import('@tiptap/react').Editor | null>;
  refreshBid: () => void;
  refreshQuestions: () => void;
}

const BidContext = createContext<BidContextValue | null>(null);

export function useBidContext() {
  const ctx = useContext(BidContext);
  if (!ctx) {
    throw new Error('useBidContext must be used within BidContextProvider');
  }
  return ctx;
}

// ────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────

interface BidContextProviderProps {
  bidId: string;
  children: ReactNode;
}

export function BidContextProvider({
  bidId,
  children,
}: BidContextProviderProps) {
  const [bid, setBid] = useState<BidSummary | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeResponse, setActiveResponse] = useState<ResponseSummary | null>(
    null,
  );
  const editorRef = useRef<import('@tiptap/react').Editor | null>(null);
  const { role } = useUserRole();

  // ── Fetch bid summary ──
  const fetchBid = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}`);
      if (!res.ok) return;
      const data = await res.json();
      const metadata = (data.domain_metadata ?? {}) as BidMetadata;
      const stats = data.question_stats;

      setBid({
        id: data.id,
        name: data.name,
        buyer: metadata.buyer ?? null,
        deadline: metadata.deadline ?? null,
        status: metadata.status ?? 'draft',
        totalQuestions: stats?.total_questions ?? 0,
        draftedCount: stats?.drafted_count ?? 0,
        reviewedCount: 0, // Not tracked separately yet
        acceptedCount: stats?.complete_count ?? 0,
      });
    } catch {
      // Non-critical for CopilotKit context
    }
  }, [bidId]);

  // ── Fetch questions ──
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}/questions`);
      if (!res.ok) return;
      const data = await res.json();

      const mapped: QuestionSummary[] = (data.questions ?? []).map(
        (q: BidQuestion, idx: number) => ({
          id: q.id,
          questionNumber: idx + 1,
          questionText: q.question_text,
          section: q.section_name,
          wordLimit: q.word_limit,
          confidencePosture: q.confidence_posture ?? 'no_content',
          responseStatus: q.response?.review_status ?? null,
        }),
      );

      setQuestions(mapped);
    } catch {
      // Non-critical
    }
  }, [bidId]);

  // ── Fetch active response when question changes ──
  const fetchActiveResponse = useCallback(async () => {
    if (!activeQuestionId) {
      setActiveResponse(null);
      return;
    }

    try {
      // Find the question in our list to get the response ID
      const question = questions.find((q) => q.id === activeQuestionId);
      if (!question) {
        setActiveResponse(null);
        return;
      }

      // We need to fetch from the questions API to get the response reference
      const questionsRes = await fetch(`/api/bids/${bidId}/questions`);
      if (!questionsRes.ok) return;
      const questionsData = await questionsRes.json();
      const fullQuestion = (questionsData.questions ?? []).find(
        (q: BidQuestion) => q.id === activeQuestionId,
      );

      if (!fullQuestion?.response?.id) {
        setActiveResponse(null);
        return;
      }

      const res = await fetch(
        `/api/bids/${bidId}/responses/${fullQuestion.response.id}`,
      );
      if (!res.ok) {
        setActiveResponse(null);
        return;
      }

      const data = await res.json();
      const wordCount = data.response_text
        ? data.response_text.split(/\s+/).filter(Boolean).length
        : 0;

      setActiveResponse({
        id: data.id,
        responseText: data.response_text ?? '',
        wordCount,
        reviewStatus: data.review_status ?? 'draft',
        sourceContentIds:
          data.source_content?.map((s: { id: string }) => s.id) ?? [],
        qualityScore: data.quality_check?.overall_score ?? null,
      });
    } catch {
      setActiveResponse(null);
    }
  }, [activeQuestionId, bidId, questions]);

  // Initial data load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
    fetchBid();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
    fetchQuestions();
  }, [fetchBid, fetchQuestions]);

  // Fetch response when active question changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on dependency change
    void fetchActiveResponse();
  }, [fetchActiveResponse]);

  // ════════════════════════════════════════════
  // CopilotKit Context Hooks
  // ════════════════════════════════════════════

  // 1. Current bid overview
  useCopilotReadable({
    description: 'Current bid details -- the bid the user is working on',
    value: bid
      ? {
          name: bid.name,
          buyer: bid.buyer,
          deadline: bid.deadline,
          status: bid.status,
          progress: `${bid.draftedCount} of ${bid.totalQuestions} questions drafted, ${bid.acceptedCount} accepted`,
        }
      : null,
  });

  // 2. Question list with confidence postures
  useCopilotReadable({
    description:
      'All questions in this bid with their confidence posture and response status',
    value: questions.map((q) => ({
      id: q.id,
      number: q.questionNumber,
      text: q.questionText.slice(0, 200),
      section: q.section,
      wordLimit: q.wordLimit,
      confidence: q.confidencePosture,
      responseStatus: q.responseStatus ?? 'not_started',
    })),
  });

  // 3. Active question detail
  useCopilotReadable({
    description: 'The question the user is currently viewing/editing',
    value: activeQuestionId
      ? questions.find((q) => q.id === activeQuestionId) ?? null
      : null,
  });

  // 4. Active response (if exists)
  useCopilotReadable({
    description:
      'The current response for the active question, if one has been drafted',
    value: activeResponse
      ? {
          wordCount: activeResponse.wordCount,
          reviewStatus: activeResponse.reviewStatus,
          qualityScore: activeResponse.qualityScore,
          sourceCount: activeResponse.sourceContentIds.length,
        }
      : null,
  });

  // 5. User role
  useCopilotReadable({
    description: 'Current user role and permissions',
    value: {
      role: role ?? 'viewer',
      canEdit: role === 'admin' || role === 'editor',
      canAdmin: role === 'admin',
    },
  });

  // 6. UI state
  useCopilotReadable({
    description: 'Current UI state -- what the user is looking at',
    value: {
      page: 'bid-session',
      activeQuestionId,
      hasEditorContent: activeResponse !== null,
    },
  });

  // 7. Question confidence breakdown
  useCopilotReadable({
    description:
      'Number of questions by confidence posture -- how well the KB covers this bid',
    value: {
      strong_match: questions.filter(
        (q) => q.confidencePosture === 'strong_match',
      ).length,
      partial_match: questions.filter(
        (q) => q.confidencePosture === 'partial_match',
      ).length,
      needs_sme: questions.filter(
        (q) => q.confidencePosture === 'needs_sme',
      ).length,
      no_content: questions.filter(
        (q) => q.confidencePosture === 'no_content',
      ).length,
    },
  });

  return (
    <BidContext.Provider
      value={{
        bidId,
        bid,
        questions,
        activeQuestionId,
        activeResponse,
        setActiveQuestionId,
        editorRef,
        refreshBid: fetchBid,
        refreshQuestions: fetchQuestions,
      }}
    >
      {children}
    </BidContext.Provider>
  );
}
