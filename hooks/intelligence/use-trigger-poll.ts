'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

/**
 * Response shape from POST /api/intelligence/trigger-poll.
 * Mirrors PipelineRunResult from lib/intelligence/types.ts.
 */
interface TriggerPollResponse {
  success: boolean;
  runId: string;
  startedAt: string;
  completedAt: string;
  sourcesProcessed: number;
  totalArticlesFound: number;
  totalArticlesNew: number;
  totalArticlesPassed: number;
  errors: string[];
}

/**
 * Triggers a manual intelligence pipeline poll (admin-only).
 *
 * Calls POST /api/intelligence/trigger-poll, then invalidates
 * workspace-level intelligence queries so data refreshes.
 */
export function useTriggerPoll(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      mutationFetchJson<TriggerPollResponse>(
        '/api/intelligence/trigger-poll',
        {},
      ),
    onSuccess: (data) => {
      // Invalidate intelligence queries so fresh data loads
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.articles.all(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.health.workspace(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: ['intelligence', 'metrics', workspaceId],
      });

      const { sourcesProcessed, totalArticlesNew, totalArticlesPassed } = data;
      toast.success(
        `Poll complete: ${sourcesProcessed} source${sourcesProcessed === 1 ? '' : 's'} processed, ` +
          `${totalArticlesNew} new article${totalArticlesNew === 1 ? '' : 's'}, ` +
          `${totalArticlesPassed} passed filter`,
      );
    },
    onError: (err: Error) => {
      toast.error(`Poll failed: ${err.message}`);
    },
  });
}
