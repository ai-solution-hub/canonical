'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

/**
 * One workspace-level flag, as returned by
 * `GET /api/intelligence/workspaces/:id/flags`.
 *
 * Mirrors the `WorkspaceFlagRow` interface defined inside the API route
 * (`app/api/intelligence/workspaces/[id]/flags/route.ts`). The route flattens
 * the joined `feed_articles` / `feed_sources` relations before serialising,
 * so the consumer never has to walk nested objects.
 */
export interface WorkspaceFlag {
  id: string;
  feed_article_id: string;
  flag_type: 'false_positive' | 'false_negative';
  flagged_by: string;
  notes: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_notes: string | null;
  resolution_type: string | null;
  prompt_version_id: string | null;
  created_at: string;
  // Joined article + source context (flattened by the API).
  article_title: string | null;
  article_external_url: string | null;
  article_relevance_score: number | null;
  article_relevance_reasoning: string | null;
  article_relevance_category: string | null;
  article_passed: boolean | null;
  source_name: string | null;
}

/** Optional client-side filters for the workspace flags query. */
/** @public */
export interface WorkspaceFlagsFilters {
  resolved?: boolean;
  flag_type?: 'false_positive' | 'false_negative';
}

/**
 * Fetch workspace-level flags via TanStack Query.
 *
 * Wraps `GET /api/intelligence/workspaces/:id/flags`. The API defaults to
 * `resolved=false`; passing an explicit `resolved` filter overrides that.
 *
 * Uses `queryKeys.intelligence.flags.list(workspaceId, filters)` so the cache
 * is keyed per (workspace, filter) tuple — switching filters does not clobber
 * a previous query's data.
 *
 * Disabled until `workspaceId` is truthy so the hook is safe to call from
 * components that mount before the workspace ID is known.
 */
export function useWorkspaceFlags(
  workspaceId: string,
  filters?: WorkspaceFlagsFilters,
) {
  return useQuery({
    queryKey: queryKeys.intelligence.flags.list(
      workspaceId,
      filters as Record<string, unknown> | undefined,
    ),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.resolved !== undefined) {
        params.set('resolved', String(filters.resolved));
      }
      if (filters?.flag_type !== undefined) {
        params.set('flag_type', filters.flag_type);
      }
      const qs = params.toString();
      const url = qs
        ? `/api/intelligence/workspaces/${workspaceId}/flags?${qs}`
        : `/api/intelligence/workspaces/${workspaceId}/flags`;
      return fetchJson<WorkspaceFlag[]>(url);
    },
    enabled: !!workspaceId,
  });
}
