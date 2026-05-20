'use client';

import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { parseProcurementMetadata } from '@/lib/validation/schemas';
import type {
  ProcurementMetadata,
  ProcurementQuestion,
} from '@/types/procurement';

// ────────────────────────────────────────────
// Context value types
// ────────────────────────────────────────────

interface ProcurementSummary {
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

/** @public */
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

interface ProcurementContextValue {
  procurementId: string;
  bid: ProcurementSummary | null;
  questions: QuestionSummary[];
  activeQuestionId: string | null;
  activeResponse: ResponseSummary | null;
  setActiveQuestionId: (id: string | null) => void;
  editorRef: React.RefObject<import('@tiptap/react').Editor | null>;
  refreshBid: () => void;
  refreshQuestions: () => void;
}

const ProcurementContext = createContext<ProcurementContextValue | null>(null);

// ────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────

interface ProcurementContextProviderProps {
  procurementId: string;
  children: ReactNode;
}

export function ProcurementContextProvider({
  procurementId,
  children,
}: ProcurementContextProviderProps) {
  const [bid, setProcurement] = useState<ProcurementSummary | null>(null);
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  // Keep raw question data to avoid redundant API fetches for response IDs
  const rawQuestionsRef = useRef<ProcurementQuestion[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [activeResponse, setActiveResponse] = useState<ResponseSummary | null>(
    null,
  );
  const editorRef = useRef<import('@tiptap/react').Editor | null>(null);

  // ── Fetch bid summary ──
  const fetchProcurement = useCallback(async () => {
    try {
      const res = await fetch(`/api/procurement/${procurementId}`);
      if (!res.ok) return;
      const data = await res.json();
      const metadata = (parseProcurementMetadata(data.domain_metadata) ??
        data.domain_metadata ??
        {}) as ProcurementMetadata;
      const stats = data.question_stats;

      setProcurement({
        id: data.id,
        name: data.name,
        buyer: metadata.buyer ?? null,
        deadline: metadata.deadline ?? null,
        status: data.status ?? 'draft',
        totalQuestions: stats?.total_questions ?? 0,
        draftedCount: stats?.drafted_count ?? 0,
        reviewedCount: 0, // Not tracked separately yet
        acceptedCount: stats?.complete_count ?? 0,
      });
    } catch (err) {
      // Non-critical — context degrades gracefully without bid data
      console.warn(
        'ProcurementContextProvider: failed to fetch bid summary:',
        err,
      );
    }
  }, [procurementId]);

  // ── Fetch questions ──
  const fetchQuestions = useCallback(async () => {
    try {
      const res = await fetch(`/api/procurement/${procurementId}/questions`);
      if (!res.ok) return;
      const data = await res.json();

      const rawQuestions: ProcurementQuestion[] = data.questions ?? [];
      rawQuestionsRef.current = rawQuestions;

      const mapped: QuestionSummary[] = rawQuestions.map(
        (q: ProcurementQuestion, idx: number) => ({
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
      console.warn(
        'ProcurementContextProvider: failed to fetch questions:',
        err,
      );
    }
  }, [procurementId]);

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
        `/api/procurement/${procurementId}/responses/${fullQuestion.response.id}`,
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
        qualityScore:
          data.overall_score ?? data.quality_check?.overall_score ?? null,
      });
    } catch (err) {
      // Non-critical — context degrades gracefully without response data
      console.warn(
        'ProcurementContextProvider: failed to fetch active response:',
        err,
      );
      setActiveResponse(null);
    }
  }, [activeQuestionId, procurementId]);

  // Initial data load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount
    fetchProcurement();
    fetchQuestions();
  }, [fetchProcurement, fetchQuestions]);

  // Fetch response when active question changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on dependency change
    void fetchActiveResponse();
  }, [fetchActiveResponse]);

  const contextValue = {
    procurementId,
    bid,
    questions,
    activeQuestionId,
    activeResponse,
    setActiveQuestionId,
    editorRef,
    refreshBid: fetchProcurement,
    refreshQuestions: fetchQuestions,
  };

  return (
    <ProcurementContext.Provider value={contextValue}>
      {children}
    </ProcurementContext.Provider>
  );
}
