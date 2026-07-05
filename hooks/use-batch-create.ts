'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchQAPair {
  question: string;
  answer: string;
}

/** @public */
export interface BatchCreateItem {
  id: string;
  title: string;
  status: 'created' | 'failed';
  error?: string;
}

/** @public */
export interface BatchCreateResult {
  created: number;
  failed: number;
  items: BatchCreateItem[];
  pipeline_run_id: string | null;
  batch_id: string;
}

/** @public */
export interface BatchCreateProgress {
  current: number;
  total: number;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  question: string;
}

/** @public */
export interface UseBatchCreateReturn {
  submit: (
    pairs: BatchQAPair[],
    options?: {
      domain?: string;
      subtopic?: string;
      sourceDocumentLink?: string;
    },
  ) => Promise<BatchCreateResult | null>;
  checkDuplicates: (pairs: BatchQAPair[]) => Promise<DuplicateMatch[]>;
  isSubmitting: boolean;
  isCheckingDuplicates: boolean;
  progress: BatchCreateProgress;
  results: BatchCreateResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Mutation variables types
// ---------------------------------------------------------------------------

interface SubmitVariables {
  pairs: BatchQAPair[];
  options?: {
    domain?: string;
    subtopic?: string;
    sourceDocumentLink?: string;
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook wrapping the `POST /api/q-a-pairs/batch` endpoint for batch Q&A
 * creation.
 *
 * ID-131 {131.21} G-MANUAL-QA: rebound off `POST /api/items/batch`
 * (content_items writes) onto the typed `q_a_pairs` table — origin_kind is
 * always 'manually_authored' on rows created here. Duplicate-checking is
 * likewise rebound to read `q_a_pairs.question_text` instead of
 * `content_items.title`.
 *
 * Provides submit, progress tracking, duplicate checking, and error handling.
 *
 * Migrated to TanStack Query: submit and checkDuplicates use useMutation,
 * with cache invalidation on successful batch creation.
 */
export function useBatchCreate(): UseBatchCreateReturn {
  const queryClient = useQueryClient();

  // Progress is updated mid-mutation (before/after API call) so stays as useState
  const [progress, setProgress] = useState<BatchCreateProgress>({
    current: 0,
    total: 0,
  });

  // -------------------------------------------------------------------------
  // Submit mutation
  // -------------------------------------------------------------------------

  const submitMutation = useMutation<BatchCreateResult, Error, SubmitVariables>(
    {
      mutationFn: async ({ pairs, options }: SubmitVariables) => {
        setProgress({ current: 0, total: pairs.length });

        // ID-131 {131.21}: q_a_pairs stores question/answer as distinct typed
        // columns — no composite "content" field to build (unlike the retired
        // content_items write path).
        const items = pairs.map((pair) => ({
          question_text: pair.question,
          answer_standard: pair.answer,
        }));

        const body: Record<string, unknown> = { items };

        // The batch API accepts source_document_id (UUID). The sourceDocumentLink
        // is a URL, so we do not pass it as source_document_id. Instead, we pass
        // it via metadata if needed in the future. For now, we only support UUID.
        if (options?.sourceDocumentLink) {
          const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidPattern.test(options.sourceDocumentLink)) {
            body.source_document_id = options.sourceDocumentLink;
          }
        }

        try {
          const result = await mutationFetchJson<BatchCreateResult>(
            '/api/q-a-pairs/batch',
            body,
          );

          setProgress({ current: pairs.length, total: pairs.length });
          return result;
        } catch (err) {
          // Re-throw with domain-specific fallback if the error is generic
          if (
            err instanceof Error &&
            err.message.startsWith('Request failed:')
          ) {
            throw new Error('Batch creation failed');
          }
          throw err;
        }
      },
      onSuccess: () => {
        // Invalidate content items cache — new q_a_pairs rows were created.
        // ID-131 {131.21}: the /library list re-point (hooks/use-library-data.ts)
        // still keys its query under queryKeys.contentItems.library(...), so
        // this invalidation continues to trigger the correct refetch.
        queryClient.invalidateQueries({ queryKey: queryKeys.contentItems.all });
      },
    },
  );

  // -------------------------------------------------------------------------
  // Duplicate check mutation
  // -------------------------------------------------------------------------

  const duplicateMutation = useMutation<DuplicateMatch[], Error, BatchQAPair[]>(
    {
      mutationFn: async (pairs: BatchQAPair[]) => {
        const supabase = createClient();
        const matches: DuplicateMatch[] = [];

        for (const pair of pairs) {
          // Trim to first 100 chars for the search to avoid overly long queries
          // Escape LIKE special characters: backslash, % and _
          const searchTerm = pair.question
            .slice(0, 100)
            .replace(/[\\%_]/g, '\\$&');
          // ID-131 {131.21}: rebound off content_items.title onto
          // q_a_pairs.question_text — this hook now writes q_a_pairs, so the
          // duplicate check must search the same table it writes to.
          const { data } = await supabase
            .from('q_a_pairs')
            .select('id, question_text')
            .ilike('question_text', `%${searchTerm}%`)
            .limit(3);

          if (data && data.length > 0) {
            for (const item of data as Array<{
              id: string;
              question_text: string;
            }>) {
              // Avoid duplicate entries in the matches list
              if (!matches.some((m) => m.id === item.id)) {
                matches.push({
                  id: item.id,
                  title: item.question_text,
                  question: pair.question,
                });
              }
            }
          }
        }

        return matches;
      },
    },
  );

  // -------------------------------------------------------------------------
  // Destructure stable functions from mutation objects
  // -------------------------------------------------------------------------

  const { mutateAsync: submitMutateAsync, reset: submitReset } = submitMutation;
  const { mutateAsync: duplicateMutateAsync } = duplicateMutation;

  // -------------------------------------------------------------------------
  // Wrapped submit that preserves the original return signature
  // -------------------------------------------------------------------------

  const submit = useCallback(
    async (
      pairs: BatchQAPair[],
      options?: {
        domain?: string;
        subtopic?: string;
        sourceDocumentLink?: string;
      },
    ): Promise<BatchCreateResult | null> => {
      try {
        // Reset stale results/error from a previous attempt before re-submitting
        submitReset();
        return await submitMutateAsync({ pairs, options });
      } catch {
        // mutateAsync throws on error — return null to match original interface
        return null;
      }
    },
    [submitMutateAsync, submitReset],
  );

  // -------------------------------------------------------------------------
  // Wrapped checkDuplicates that preserves the original return signature
  // -------------------------------------------------------------------------

  const checkDuplicates = useCallback(
    async (pairs: BatchQAPair[]): Promise<DuplicateMatch[]> => {
      try {
        return await duplicateMutateAsync(pairs);
      } catch {
        // Non-fatal — duplicate checking is best-effort
        return [];
      }
    },
    [duplicateMutateAsync],
  );

  return {
    submit,
    checkDuplicates,
    isSubmitting: submitMutation.isPending,
    isCheckingDuplicates: duplicateMutation.isPending,
    progress,
    results: submitMutation.data ?? null,
    error: submitMutation.error?.message ?? null,
  };
}
