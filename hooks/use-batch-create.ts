'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { createClient } from '@/lib/supabase/client';
import { formatQAContent } from '@/components/qa/batch-qa-preview-table';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchQAPair {
  question: string;
  answer: string;
}

export interface BatchCreateItem {
  id: string;
  title: string;
  status: 'created' | 'failed';
  error?: string;
}

export interface BatchCreateResult {
  created: number;
  failed: number;
  items: BatchCreateItem[];
  pipeline_run_id: string | null;
  batch_id: string;
}

export interface BatchCreateProgress {
  current: number;
  total: number;
}

export interface DuplicateMatch {
  id: string;
  title: string;
  question: string;
}

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
 * Hook wrapping the `POST /api/items/batch` endpoint for batch Q&A creation.
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

  const submitMutation = useMutation<
    BatchCreateResult,
    Error,
    SubmitVariables
  >({
    mutationFn: async ({ pairs, options }: SubmitVariables) => {
      setProgress({ current: 0, total: pairs.length });

      const items = pairs.map((pair) => ({
        title: pair.question,
        content: formatQAContent(pair),
        contentType: 'q_a_pair' as const,
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
          '/api/items/batch',
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
      // Invalidate content items cache — new items were created
      queryClient.invalidateQueries({ queryKey: queryKeys.contentItems.all });
    },
  });

  // -------------------------------------------------------------------------
  // Duplicate check mutation
  // -------------------------------------------------------------------------

  const duplicateMutation = useMutation<
    DuplicateMatch[],
    Error,
    BatchQAPair[]
  >({
    mutationFn: async (pairs: BatchQAPair[]) => {
      const supabase = createClient();
      const matches: DuplicateMatch[] = [];

      for (const pair of pairs) {
        // Trim to first 100 chars for the search to avoid overly long queries
        const searchTerm = pair.question
          .slice(0, 100)
          .replace(/%/g, '\\%');
        const { data } = await supabase
          .from('content_items')
          .select('id, title')
          .ilike('title', `%${searchTerm}%`)
          .limit(3);

        if (data && data.length > 0) {
          for (const item of data) {
            // Avoid duplicate entries in the matches list
            if (!matches.some((m) => m.id === item.id)) {
              matches.push({
                id: item.id,
                title: item.title,
                question: pair.question,
              });
            }
          }
        }
      }

      return matches;
    },
  });

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
