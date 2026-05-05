'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface FeedSource {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  source_type?: 'rss' | 'web' | 'api';
  polling_interval_minutes: number;
  is_active: boolean;
  last_polled_at: string | null;
  last_status: string | null;
  consecutive_failures: number;
  etag: string | null;
  last_modified: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedSourceInput {
  name: string;
  url: string;
  source_type?: 'rss' | 'web' | 'api';
  polling_interval_minutes?: number;
  is_active?: boolean;
}

/**
 * Response from POST /api/intelligence/workspaces/:id/sources
 *
 * For RSS sources, the API runs `validateFeedUrl()` and includes the parsed
 * feed title and article count alongside the inserted row. Non-RSS sources
 * (web, api) skip validation and only return the row fields.
 */
/** @public */
export interface CreateFeedSourceResponse extends FeedSource {
  feed_title?: string;
  initial_article_count?: number;
}

export interface TestPollResult {
  success: boolean;
  itemCount: number;
  sampleTitles: string[];
  error?: string;
}

export function useFeedSources(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.sources.list(workspaceId),
    queryFn: () =>
      fetchJson<FeedSource[]>(
        `/api/intelligence/workspaces/${workspaceId}/sources`,
      ),
    enabled: !!workspaceId,
  });
}

export function useCreateFeedSource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: FeedSourceInput) =>
      mutationFetchJson<CreateFeedSourceResponse>(
        `/api/intelligence/workspaces/${workspaceId}/sources`,
        data,
      ),
    onSuccess: (response) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.sources.all(workspaceId),
      });
      // SI-M5: surface the validated feed metadata so users get confirmation
      // they added the right feed (title from validateFeedUrl + article count).
      const title = response.feed_title?.trim();
      const articleCount = response.initial_article_count;
      if (title && typeof articleCount === 'number') {
        const articleLabel = articleCount === 1 ? 'article' : 'articles';
        toast.success(
          `Added "${title}" (${articleCount} ${articleLabel} available)`,
        );
      } else if (title) {
        toast.success(`Added "${title}"`);
      } else {
        toast.success('Feed source added');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateFeedSource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceId,
      data,
    }: {
      sourceId: string;
      data: Partial<FeedSourceInput>;
    }) =>
      mutationFetchJson<FeedSource>(
        `/api/intelligence/workspaces/${workspaceId}/sources/${sourceId}`,
        data,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.sources.all(workspaceId),
      });
      toast.success('Feed source updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteFeedSource(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      mutationFetchJson<void>(
        `/api/intelligence/workspaces/${workspaceId}/sources/${sourceId}`,
        {},
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.sources.all(workspaceId),
      });
      toast.success('Feed source archived');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useTestFeedSource(workspaceId: string) {
  return useMutation({
    mutationFn: (sourceId: string) =>
      mutationFetchJson<TestPollResult>(
        `/api/intelligence/workspaces/${workspaceId}/sources/${sourceId}/test`,
        {},
      ),
    onError: (err: Error) => toast.error(err.message),
  });
}
