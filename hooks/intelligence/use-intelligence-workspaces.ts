'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export interface IntelligenceWorkspace {
  id: string;
  name: string;
  description: string | null;
  type: 'intelligence';
  domain_metadata: {
    company_profile_id: string;
    guide_id?: string;
    /** SI-L5: workspace-level relevance threshold (0.1–1.0); falls back to DEFAULT_RELEVANCE_THRESHOLD */
    relevance_threshold?: number;
  };
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  /** Joined from company_profiles */
  company_profile_name?: string;
  /** Aggregate counts */
  source_count?: number;
  article_count?: number;
  passed_article_count?: number;
}

export interface IntelligenceWorkspaceInput {
  name: string;
  description?: string;
  company_profile_id: string;
}

/**
 * Update payload for PATCH /api/intelligence/workspaces/:id.
 * `relevance_threshold` is admin-only and is merged server-side into
 * the workspace's `domain_metadata` JSONB column.
 */
export interface IntelligenceWorkspaceUpdateInput {
  name?: string;
  description?: string;
  /** SI-L5: relevance threshold between 0.1 and 1.0 (admin only) */
  relevance_threshold?: number;
}

export function useIntelligenceWorkspaces() {
  return useQuery({
    queryKey: queryKeys.intelligence.workspaces.list,
    queryFn: () =>
      fetchJson<IntelligenceWorkspace[]>('/api/intelligence/workspaces'),
  });
}

export function useIntelligenceWorkspace(id: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.workspaces.detail(id),
    queryFn: () =>
      fetchJson<IntelligenceWorkspace>(`/api/intelligence/workspaces/${id}`),
    enabled: !!id,
  });
}

export function useCreateIntelligenceWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IntelligenceWorkspaceInput) =>
      mutationFetchJson<IntelligenceWorkspace>(
        '/api/intelligence/workspaces',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.workspaces.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast.success('Intelligence workspace created');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateIntelligenceWorkspace(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: IntelligenceWorkspaceUpdateInput) =>
      mutationFetchJson<IntelligenceWorkspace>(
        `/api/intelligence/workspaces/${id}`,
        data,
        { method: 'PATCH' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.workspaces.all,
      });
      toast.success('Workspace updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
