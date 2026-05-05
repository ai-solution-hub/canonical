'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

export type ArticleTab = 'passed' | 'filtered';

interface ArticleFilters {
  tab: ArticleTab;
  page: number;
  limit: number;
  source_id?: string;
}

export interface FeedArticle {
  id: string;
  title: string;
  external_url: string;
  relevance_score: number | null;
  relevance_category: 'high' | 'medium' | 'low' | 'irrelevant' | null;
  relevance_reasoning: string | null;
  ai_summary: string | null;
  ingested_at: string;
  published_at: string | null;
  content_item_id: string | null;
  passed: boolean;
  source_name: string | null;
  flag_count: number;
}

interface ArticlesResponse {
  articles: FeedArticle[];
  total: number;
  page: number;
  limit: number;
}

interface FeedFlag {
  id: string;
  feed_article_id: string;
  flag_type: 'false_positive' | 'false_negative';
  flagged_by: string;
  notes: string | null;
  resolved: boolean;
  resolved_at: string | null;
  prompt_version_id: string | null;
  created_at: string;
}

interface FlagInput {
  flag_type: 'false_positive' | 'false_negative';
  notes?: string;
}

export function useFeedArticles(workspaceId: string, filters: ArticleFilters) {
  return useQuery({
    queryKey: queryKeys.intelligence.articles.list(
      workspaceId,
      filters as unknown as Record<string, unknown>,
    ),
    queryFn: () => {
      // Build URLSearchParams inside the queryFn closure so TanStack's
      // exhaustive-deps rule is satisfied — `filters` is already a cache
      // key via the line above, so the params derived from it are
      // correctly scoped to a single cache entry.
      const params = new URLSearchParams({
        tab: filters.tab,
        page: String(filters.page),
        limit: String(filters.limit),
      });
      if (filters.source_id) {
        params.set('source_id', filters.source_id);
      }
      return fetchJson<ArticlesResponse>(
        `/api/intelligence/workspaces/${workspaceId}/articles?${params.toString()}`,
      );
    },
    enabled: !!workspaceId,
  });
}

export function useFlagArticle(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ articleId, data }: { articleId: string; data: FlagInput }) =>
      mutationFetchJson<FeedFlag>(
        `/api/intelligence/workspaces/${workspaceId}/articles/${articleId}/flag`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intelligence.articles.all(workspaceId),
      });
      toast.success('Article flagged');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
