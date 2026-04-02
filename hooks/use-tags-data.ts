'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { DuplicateGroup } from '@/components/settings/duplicate-review';
import type { DomainTagGroup } from '@/components/settings/tag-domain-view';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TagCount {
  tag: string;
  count: number;
  source: 'user' | 'ai';
}

interface MutationResult {
  affected: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages tag data and mutations for the settings Tags section.
 *
 * Replaces the manual fetch/setState/useEffect pattern in tags-section.tsx
 * with TanStack Query for caching, deduplication, and automatic refetch.
 *
 * Task 4: All mutations use `mutationFetchJson` instead of raw `fetch()`.
 */
export function useTagsData() {
  const queryClient = useQueryClient();

  // ─── Queries ───

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: queryKeys.tags.list,
    queryFn: () => fetchJson<TagCount[]>('/api/tags'),
  });

  const { data: duplicates = [], isLoading: duplicatesLoading } = useQuery({
    queryKey: queryKeys.tags.duplicates,
    queryFn: () => fetchJson<DuplicateGroup[]>('/api/tags/duplicates?type=ai'),
  });

  const { data: domainGroups = [], isLoading: domainGroupsLoading } = useQuery({
    queryKey: queryKeys.tags.byDomain,
    queryFn: () => fetchJson<DomainTagGroup[]>('/api/tags/by-domain?type=ai'),
  });

  const loading = tagsLoading || duplicatesLoading || domainGroupsLoading;

  // ─── Shared invalidation after any tag mutation ───

  const invalidateAllTags = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
  };

  // ─── Mutations (Task 4: use mutationFetchJson, not raw fetch) ───

  const renameMutation = useMutation({
    mutationFn: (params: { old: string; new: string; type: string }) =>
      mutationFetchJson<MutationResult>('/api/tags/rename', params),
    onSuccess: (data, variables) => {
      toast.success(
        `Renamed "${variables.old}" to "${variables.new}" (${data.affected} items updated)`,
      );
      invalidateAllTags();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to rename tag',
      );
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (params: { source: string; target: string; type: string }) =>
      mutationFetchJson<MutationResult>('/api/tags/merge', params),
    onSuccess: (data, variables) => {
      toast.success(
        `Merged "${variables.source}" into "${variables.target}" (${data.affected} items updated)`,
      );
      invalidateAllTags();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to merge tags',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (params: { tag: string; type: string }) =>
      mutationFetchJson<MutationResult>('/api/tags', params, {
        method: 'DELETE',
      }),
    onSuccess: (data, variables) => {
      toast.success(
        `Deleted "${variables.tag}" (${data.affected} items updated)`,
      );
      invalidateAllTags();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete tag',
      );
    },
  });

  return {
    tags,
    duplicates,
    domainGroups,
    loading,
    renameMutation,
    mergeMutation,
    deleteMutation,
    /** Manually invalidate all tag caches (e.g. after external bulk actions) */
    invalidateAllTags,
  };
}
