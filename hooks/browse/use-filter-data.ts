'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import {
  parseJsonb,
  parseJsonbArray,
  FilterCountsSchema,
  AuthorCountSchema,
} from '@/lib/validation/jsonb';
import { createClient } from '@/lib/supabase/client';
import type { Workspace } from '@/types/content';

// Hoisted lazily so SSR / static-generation doesn't trigger client construction
// at module-evaluation time. Once resolved, the same singleton is returned for
// every render — see lib/supabase/client.ts. Keeping this as a function
// reference (not a per-render `createClient()` call inside the hook body) means
// the TanStack Query exhaustive-deps lint rule does not see an unstable
// closure dep, and the four `supabase` warnings stay fixed.
function getSupabase() {
  return createClient();
}

/** @public */
export type FilterCounts = {
  domain: Record<string, number>;
  content_type: Record<string, number>;
  platform: Record<string, number>;
};

interface UseFilterDataParams {
  isOpen: boolean;
}

const EMPTY_COUNTS: FilterCounts = {
  domain: {},
  content_type: {},
  platform: {},
};

/**
 * Manages async data loading for filter panel options.
 *
 * All fetches are lazy-loaded: they only fire when the panel is opened
 * (via `enabled: isOpen`). TanStack Query manages caching and deduplication.
 *
 * Filter counts use `staleTime: 30_000` to match the previous 30-second
 * cache TTL. All other categories use `staleTime: Infinity` to match the
 * previous "fetch once per mount" behaviour.
 */
export function useFilterData({ isOpen }: UseFilterDataParams) {
  // UI-only search state — not server data
  const [authorSearch, setAuthorSearch] = useState('');

  // ─── Filter counts (30s stale time, matching previous TTL) ───

  const countsQuery = useQuery({
    queryKey: queryKeys.filters.counts,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_filter_counts');
      if (error || !data) {
        console.error('Failed to fetch filter counts:', error?.message);
        return EMPTY_COUNTS;
      }
      const parsed = parseJsonb(FilterCountsSchema, data);
      return {
        domain: parsed?.domain ?? {},
        content_type: parsed?.content_type ?? {},
        platform: parsed?.platform ?? {},
      } satisfies FilterCounts;
    },
    enabled: isOpen,
    staleTime: 30_000,
  });

  // ─── Authors (fetch once per session) ───

  const authorsQuery = useQuery({
    queryKey: queryKeys.filters.authors,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_unique_authors');
      if (error || !data) {
        console.error('Failed to fetch authors:', error?.message);
        return [];
      }
      return parseJsonbArray(AuthorCountSchema, data).map((row) => ({
        name: row.author_name,
        count: Number(row.count),
      }));
    },
    enabled: isOpen,
    staleTime: Infinity,
  });

  // ─── Popular keywords (fetch once per session) ───

  const keywordsQuery = useQuery({
    queryKey: queryKeys.filters.keywords,
    queryFn: async () => {
      const data = await fetchJson<{ keywords?: string[] }>(
        '/api/search/suggestions',
      );
      return data.keywords ?? [];
    },
    enabled: isOpen,
    staleTime: Infinity,
  });

  // ─── Workspaces (fetch once per session) ───

  const workspacesQuery = useQuery({
    queryKey: queryKeys.filters.workspaces,
    queryFn: () => fetchJson<Workspace[]>('/api/workspaces'),
    enabled: isOpen,
    staleTime: Infinity,
  });

  // ─── User tags (fetch once per session) ───

  const userTagsQuery = useQuery({
    queryKey: queryKeys.filters.userTags,
    queryFn: async () => {
      const { data } = await getSupabase().rpc('get_user_tag_counts');
      if (!data || typeof data !== 'object') return [];
      const tagCounts = data as Record<string, number>;
      return Object.entries(tagCounts)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    },
    enabled: isOpen,
    staleTime: Infinity,
  });

  // ─── Entities (fetch once per session) ───

  const entitiesQuery = useQuery({
    queryKey: queryKeys.filters.entities,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_entity_summary', {
        p_limit: 50,
      });
      if (error || !data) return [];
      return data.map(
        (row: {
          canonical_name: string;
          entity_type: string;
          mention_count: number;
        }) => ({
          name: row.canonical_name,
          type: row.entity_type,
          count: Number(row.mention_count),
        }),
      );
    },
    enabled: isOpen,
    staleTime: Infinity,
  });

  // ─── Derived: entity type counts ───

  const entityTypeCounts = useMemo(() => {
    const entities = entitiesQuery.data ?? [];
    const typeCounts = new Map<string, number>();
    for (const entity of entities) {
      typeCounts.set(
        entity.type,
        (typeCounts.get(entity.type) ?? 0) + entity.count,
      );
    }
    return Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [entitiesQuery.data]);

  return {
    counts: countsQuery.data ?? EMPTY_COUNTS,
    authorSearch,
    setAuthorSearch,
    allAuthors: authorsQuery.data ?? [],
    popularKeywords: keywordsQuery.data ?? [],
    allWorkspaces: workspacesQuery.data ?? [],
    allUserTags: userTagsQuery.data ?? [],
    allEntities: entitiesQuery.data ?? [],
    entityTypeCounts,
  };
}
