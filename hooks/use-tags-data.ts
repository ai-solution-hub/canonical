/**
 * TanStack Query hook for tag management data.
 *
 * Extracts all data-fetching and mutation logic from TagsSection into a
 * reusable hook. Provides three queries (tags list, duplicates, domain groups)
 * and three mutations (rename, merge, delete) with automatic cache
 * invalidation via queryKeys.tags.all.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
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

interface MutationResponse {
  affected: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTagsData() {
  const queryClient = useQueryClient();

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

  // Shared invalidation after any tag mutation
  const invalidateAllTags = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tags.all });
  };

  const renameMutation = useMutation({
    mutationFn: async (params: { old: string; new: string; type: string }) => {
      const res = await fetch('/api/tags/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename tag');
      return data as MutationResponse;
    },
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
    mutationFn: async (params: {
      source: string;
      target: string;
      type: string;
    }) => {
      const res = await fetch('/api/tags/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to merge tags');
      return data as MutationResponse;
    },
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
    mutationFn: async (params: { tag: string; type: string }) => {
      const res = await fetch('/api/tags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tag');
      return data as MutationResponse;
    },
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
    /** Manually invalidate all tag queries (for child components that trigger refreshes). */
    invalidateAllTags,
  };
}
