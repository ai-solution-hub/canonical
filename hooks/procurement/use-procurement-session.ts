'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, ApiError } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { ProcurementQuestion } from '@/types/procurement';
import type {
  ProcurementSummary,
  ProcurementResponse,
  NavigatorQuestion,
} from '@/hooks/streaming/use-stream-coordination';

// Module-level stable empty array — keeps `questions` identity stable across
// renders while `questionsQuery.data` is undefined.
const EMPTY_QUESTIONS: ProcurementQuestion[] = [];

// ── Fetcher functions ──

async function fetchProcurementSummary(
  procurementId: string,
): Promise<ProcurementSummary | null> {
  try {
    return await fetchJson<ProcurementSummary>(
      `/api/procurement/${procurementId}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

async function fetchProcurementQuestions(
  procurementId: string,
): Promise<ProcurementQuestion[]> {
  // S152B WP5 / Q-37: do NOT swallow fetch errors here. Returning `[]`
  // on failure made the caller render an empty-but-valid-looking state,
  // masking real connectivity / auth / server problems from TanStack
  // Query's `isError`/`error` state. Let the error propagate so the UI
  // can render "Failed to load bid questions" instead.
  const data = await fetchJson<{ questions: ProcurementQuestion[] }>(
    `/api/procurement/${procurementId}/questions`,
  );
  return data.questions ?? [];
}

async function fetchProcurementResponseData(
  procurementId: string,
  responseId: string,
): Promise<ProcurementResponse | null> {
  // S152B WP5 / Q-37: do NOT swallow fetch errors here. Returning `null`
  // on failure made the caller render an empty editor instead of an
  // error state, masking real failures from TanStack Query. 404 is NOT
  // handled specially — the queryFn caller guards on `!responseId`
  // before this fetcher runs, so a 404 at the API layer now means the
  // response id is genuinely missing from the DB (a real error worth
  // surfacing, not a "no response yet" signal).
  return await fetchJson<ProcurementResponse>(
    `/api/procurement/${procurementId}/responses/${responseId}`,
  );
}

// ── Hook ──

/** @public */
export interface UseProcurementSessionReturn {
  bid: ProcurementSummary | null;
  questions: ProcurementQuestion[];
  loading: boolean;
  error: string | null;
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  currentQuestion: ProcurementQuestion | null;
  response: ProcurementResponse | null;
  responseLoading: boolean;
  navigatorQuestions: NavigatorQuestion[];
  invalidateProcurementData: () => Promise<void>;
  invalidateResponse: () => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
}

/**
 * Data layer for the bid session page.
 * Fetches and caches bid metadata, questions, and the current response
 * using TanStack Query.
 */
export function useProcurementSession(
  procurementId: string,
): UseProcurementSessionReturn {
  const router = useRouter();
  const queryClient = useQueryClient();

  // ── Procurement metadata query ──
  // queryFn deliberately does NOT close over `router`; redirect happens in
  // the effect below so the query closure stays free of unstable references
  // and satisfies @tanstack/query/exhaustive-deps.
  const procurementQuery = useQuery({
    queryKey: queryKeys.bids.detail(procurementId),
    queryFn: () => fetchProcurementSummary(procurementId),
  });

  useEffect(() => {
    if (procurementQuery.isSuccess && procurementQuery.data === null) {
      toast.error('Procurement not found');
      router.push('/procurement');
    }
  }, [procurementQuery.isSuccess, procurementQuery.data, router]);

  // ── Questions query ──
  const questionsQuery = useQuery({
    queryKey: queryKeys.bids.questions(procurementId),
    queryFn: () => fetchProcurementQuestions(procurementId),
  });

  // ── Navigation state ──
  const [currentIndex, setCurrentIndex] = useState(0);

  const bid = procurementQuery.data ?? null;
  // Wrap in useMemo so `questions` has a stable identity across renders when
  // `questionsQuery.data` is undefined. Without this, `[]` on the right-hand
  // side of `??` creates a fresh array every render and invalidates the
  // downstream `navigatorQuestions` memo. Note: with React Compiler enabled
  // this pattern would be automatic, but the lint rule still requires it.
  const questions = useMemo(
    () => questionsQuery.data ?? EMPTY_QUESTIONS,
    [questionsQuery.data],
  );
  const loading = procurementQuery.isLoading || questionsQuery.isLoading;

  const currentQuestion = questions[currentIndex] ?? null;
  const responseId = currentQuestion?.response?.id ?? null;

  // ── Response query (per question) ──
  // The queryKey includes `responseId` as a suffix on top of the
  // standard `responseByQuestion(procurementId, questionId)` prefix. This is
  // required because the queryFn loads data keyed by responseId — if a
  // question's response is replaced (same questionId, new responseId),
  // the cache must bust. Existing invalidators use the 4-element prefix
  // and continue to work because TanStack Query matches by prefix.
  const responseQuery = useQuery({
    queryKey: [
      ...queryKeys.bids.responseByQuestion(
        procurementId,
        currentQuestion?.id ?? '',
      ),
      responseId ?? '',
    ] as const,
    queryFn: async () => {
      if (!responseId) return null;
      return fetchProcurementResponseData(procurementId, responseId);
    },
    enabled: !!currentQuestion,
    // Prevent background refetch from overwriting user edits (S126 item 2)
    refetchOnWindowFocus: false,
  });

  const response = responseQuery.data ?? null;
  const responseLoading = responseQuery.isLoading;

  // S152B WP5 / Q-37: surface errors from all three queries, not just
  // `procurementQuery`. Previously `fetchProcurementQuestions` and `fetchProcurementResponseData`
  // swallowed their errors and returned empty values, so only `procurementQuery`
  // errors were ever observable. Now that the fetchers re-throw, the
  // combined `error` field reflects whichever query failed first.
  const error =
    procurementQuery.error?.message ??
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
  const invalidateProcurementData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.detail(procurementId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.questions(procurementId),
    });
  }, [queryClient, procurementId]);

  const invalidateResponse = useCallback(async () => {
    if (!currentQuestion) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.bids.responseByQuestion(
        procurementId,
        currentQuestion.id,
      ),
    });
  }, [queryClient, procurementId, currentQuestion]);

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
    invalidateProcurementData,
    invalidateResponse,
    queryClient,
  };
}
