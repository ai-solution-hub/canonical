'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, ApiError } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { BidQuestion } from '@/types/bid';
import type {
  BidSummary,
  BidResponse,
  NavigatorQuestion,
} from '@/hooks/streaming/use-stream-coordination';

// ── Fetcher functions ──

async function fetchBidSummary(bidId: string): Promise<BidSummary | null> {
  try {
    return await fetchJson<BidSummary>(`/api/bids/${bidId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

async function fetchBidQuestions(bidId: string): Promise<BidQuestion[]> {
  try {
    const data = await fetchJson<{ questions: BidQuestion[] }>(
      `/api/bids/${bidId}/questions`,
    );
    return data.questions ?? [];
  } catch {
    return [];
  }
}

async function fetchBidResponseData(
  bidId: string,
  responseId: string,
): Promise<BidResponse | null> {
  try {
    return await fetchJson<BidResponse>(
      `/api/bids/${bidId}/responses/${responseId}`,
    );
  } catch {
    return null;
  }
}

// ── Hook ──

export interface UseBidSessionReturn {
  bid: BidSummary | null;
  questions: BidQuestion[];
  loading: boolean;
  error: string | null;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  currentQuestion: BidQuestion | null;
  response: BidResponse | null;
  responseLoading: boolean;
  navigatorQuestions: NavigatorQuestion[];
  invalidateBidData: () => Promise<void>;
  invalidateResponse: () => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
}

/**
 * Data layer for the bid session page.
 * Fetches and caches bid metadata, questions, and the current response
 * using TanStack Query.
 */
export function useBidSession(bidId: string): UseBidSessionReturn {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Bid metadata query ──
  // queryFn deliberately does NOT close over `router`; redirect happens in
  // the effect below so the query closure stays free of unstable references
  // and satisfies @tanstack/query/exhaustive-deps.
  const bidQuery = useQuery({
    queryKey: queryKeys.bids.detail(bidId),
    queryFn: () => fetchBidSummary(bidId),
  });

  useEffect(() => {
    if (bidQuery.isSuccess && bidQuery.data === null) {
      toast.error('Bid not found');
      router.push('/bid');
    }
  }, [bidQuery.isSuccess, bidQuery.data, router]);

  // ── Questions query ──
  const questionsQuery = useQuery({
    queryKey: queryKeys.bids.questions(bidId),
    queryFn: () => fetchBidQuestions(bidId),
  });

  // ── Navigation state ──
  const [currentIndex, setCurrentIndex] = useState(0);

  const bid = bidQuery.data ?? null;
  const questions = questionsQuery.data ?? [];
  const loading = bidQuery.isLoading || questionsQuery.isLoading;
  const error = bidQuery.error?.message ?? null;

  const currentQuestion = questions[currentIndex] ?? null;
  const responseId = currentQuestion?.response?.id ?? null;

  // ── Response query (per question) ──
  // The queryKey includes `responseId` as a suffix on top of the
  // standard `responseByQuestion(bidId, questionId)` prefix. This is
  // required because the queryFn loads data keyed by responseId — if a
  // question's response is replaced (same questionId, new responseId),
  // the cache must bust. Existing invalidators use the 4-element prefix
  // and continue to work because TanStack Query matches by prefix.
  const responseQuery = useQuery({
    queryKey: [
      ...queryKeys.bids.responseByQuestion(bidId, currentQuestion?.id ?? ''),
      responseId ?? '',
    ] as const,
    queryFn: async () => {
      if (!responseId) return null;
      return fetchBidResponseData(bidId, responseId);
    },
    enabled: !!currentQuestion,
    // Prevent background refetch from overwriting user edits (S126 item 2)
    refetchOnWindowFocus: false,
  });

  const response = responseQuery.data ?? null;
  const responseLoading = responseQuery.isLoading;

  // ── Navigator questions (derived) ──
  const navigatorQuestions: NavigatorQuestion[] = useMemo(
    () =>
      questions.map((q) => ({
        id: q.id,
        question_text: q.question_text,
        section_name: q.section_name,
        confidence_posture: q.confidence_posture,
        status: q.status,
      })),
    [questions],
  );

  // ── Imperative invalidation wrappers ──
  const invalidateBidData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.detail(bidId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.questions(bidId),
    });
  }, [queryClient, bidId]);

  const invalidateResponse = useCallback(async () => {
    if (!currentQuestion) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.responseByQuestion(bidId, currentQuestion.id),
    });
  }, [queryClient, bidId, currentQuestion]);

  return {
    bid,
    questions,
    loading,
    error,
    currentIndex,
    setCurrentIndex,
    currentQuestion,
    response,
    responseLoading,
    navigatorQuestions,
    invalidateBidData,
    invalidateResponse,
    queryClient,
  };
}
