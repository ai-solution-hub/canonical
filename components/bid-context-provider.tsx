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
import { parseBidMetadata } from '@/lib/validation/schemas';
import type { BidMetadata, BidQuestion } from '@/types/bid';

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
  // Keep raw question data to avoid redundant API fetches for response IDs
  const rawQuestionsRef = useRef<BidQuestion[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeResponse, setActiveResponse] = useState<ResponseSummary | null>(
    null,
  );
  const editorRef = useRef<import('@tiptap/react').Editor | null>(null);

  // ── Fetch bid summary ──
  const fetchBid = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}`);
      if (!res.ok) return;
      const data = await res.json();
      const metadata = (parseBidMetadata(data.domain_metadata) ?? data.domain_metadata ?? {}) as BidMetadata;
      const stats = data.question_stats;

      setBid({
        id: data.id,
        name: data.name,
        buyer: metadata.buyer ?? null,
        deadline: metadata.deadline ?? null,
        status: data.status ?? metadata.status ?? 'draft',
        totalQuestions: stats?.total_questions ?? 0,
        draftedCount: stats?.drafted_count ?? 0,
        reviewedCount: 0, // Not tracked separately yet
        acceptedCount: stats?.complete_count ?? 0,
      });
    } catch (err) {
      // Non-critical — context degrades gracefully without bid data
      console.warn('BidContextProvider: failed to fetch bid summary:', err);
    }
  }, [bidId]);

  // ── Fetch questions ──
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/bids/${bidId}/questions`);
      if (!res.ok) return;
      const data = await res.json();

      const rawQuestions: BidQuestion[] = data.questions ?? [];
      rawQuestionsRef.current = rawQuestions;

      const mapped: QuestionSummary[] = rawQuestions.map(
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
    } catch (err) {
      // Non-critical — context degrades gracefully without question data
      console.warn('BidContextProvider: failed to fetch questions:', err);
    }
  }, [bidId]);

  // ── Fetch active response when question changes ──
  const fetchActiveResponse = useCallback(async () => {
    if (!activeQuestionId) {
      setActiveResponse(null);
      return;
    }

    try {
      // Look up the response ID from already-fetched raw question data
      // instead of making a redundant API call to /questions
      const fullQuestion = rawQuestionsRef.current.find(
        (q) => q.id === activeQuestionId,
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
        qualityScore: data.overall_score ?? data.quality_check?.overall_score ?? null,
      });
    } catch (err) {
      // Non-critical — context degrades gracefully without response data
      console.warn('BidContextProvider: failed to fetch active response:', err);
      setActiveResponse(null);
    }
  }, [activeQuestionId, bidId]);

  // Initial data load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
    fetchBid();
    fetchQuestions();
  }, [fetchBid, fetchQuestions]);

  // Fetch response when active question changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on dependency change
    void fetchActiveResponse();
  }, [fetchActiveResponse]);

  const contextValue = {
    bidId,
    bid,
    questions,
    activeQuestionId,
    activeResponse,
    setActiveQuestionId,
    editorRef,
    refreshBid: fetchBid,
    refreshQuestions: fetchQuestions,
  };

  return (
    <BidContext.Provider value={contextValue}>
      {children}
    </BidContext.Provider>
  );
}
