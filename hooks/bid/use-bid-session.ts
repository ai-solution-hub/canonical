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

// Module-level stable empty array — keeps `questions` identity stable across
// renders while `questionsQuery.data` is undefined.
const EMPTY_QUESTIONS: BidQuestion[] = [];

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
  // S152B WP5 / Q-37: do NOT swallow fetch errors here. Returning `[]`
  // on failure made the caller render an empty-but-valid-looking state,
  // masking real connectivity / auth / server problems from TanStack
  // Query's `isError`/`error` state. Let the error propagate so the UI
  // can render "Failed to load bid questions" instead.
  const data = await fetchJson<{ questions: BidQuestion[] }>(
    `/api/bids/${bidId}/questions`,
  );
  return data.questions ?? [];
}

async function fetchBidResponseData(
  bidId: string,
  responseId: string,
): Promise<BidResponse | null> {
  // S152B WP5 / Q-37: do NOT swallow fetch errors here. Returning `null`
  // on failure made the caller render an empty editor instead of an
  // error state, masking real failures from TanStack Query. 404 is NOT
  // handled specially — the queryFn caller guards on `!responseId`
  // before this fetcher runs, so a 404 at the API layer now means the
  // response id is genuinely missing from the DB (a real error worth
  // surfacing, not a "no response yet" signal).
  return await fetchJson<BidResponse>(
    `/api/bids/${bidId}/responses/${responseId}`,
  );
}

// ── Hook ──

/** @public */
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
  // Wrap in useMemo so `questions` has a stable identity across renders when
  // `questionsQuery.data` is undefined. Without this, `[]` on the right-hand
  // side of `??` creates a fresh array every render and invalidates the
  // downstream `navigatorQuestions` memo. Note: with React Compiler enabled
  // this pattern would be automatic, but the lint rule still requires it.
  const questions = useMemo(
    () => questionsQuery.data ?? EMPTY_QUESTIONS,
    [questionsQuery.data],
  );
  const loading = bidQuery.isLoading || questionsQuery.isLoading;

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

  // S152B WP5 / Q-37: surface errors from all three queries, not just
  // `bidQuery`. Previously `fetchBidQuestions` and `fetchBidResponseData`
  // swallowed their errors and returned empty values, so only `bidQuery`
  // errors were ever observable. Now that the fetchers re-throw, the
  // combined `error` field reflects whichever query failed first.
  const error =
    bidQuery.error?.message ??
    questionsQuery.error?.message ??
    responseQuery.error?.message ??
    null;

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
