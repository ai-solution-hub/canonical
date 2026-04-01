'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface FeedPrompt {
  id: string;
  workspace_id: string;
  version: number;
  prompt_text: string;
  is_active: boolean;
  performance_snapshot: {
    total_articles: number;
    passed_articles: number;
    filtered_articles: number;
    pass_rate: number;
    captured_at: string;
    period: string;
  } | null;
  change_notes: string | null;
  created_at: string;
  created_by: string | null;
}

export function useFeedPrompts(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.prompts.list(workspaceId),
    queryFn: () =>
      fetchJson<FeedPrompt[]>(
        `/api/intelligence/workspaces/${workspaceId}/prompts`,
      ),
    enabled: !!workspaceId,
  });
}

export function useCreatePromptVersion(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { prompt_text: string; change_notes?: string }) =>
      mutationFetchJson<FeedPrompt>(
        `/api/intelligence/workspaces/${workspaceId}/prompts`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.prompts.all(workspaceId),
      });
      toast.success('New prompt version saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRollbackPrompt(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      mutationFetchJson<FeedPrompt>(
        `/api/intelligence/workspaces/${workspaceId}/prompts`,
        { action: 'rollback', from_version_id: versionId },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.prompts.all(workspaceId),
      });
      toast.success('Rolled back to previous prompt version');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
