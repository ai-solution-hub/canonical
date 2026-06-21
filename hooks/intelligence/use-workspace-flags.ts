'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type { WorkspaceFlag } from '@/lib/intelligence/flags';

// Re-export so existing consumers can keep importing `WorkspaceFlag` from this
// hook; the canonical home is `@/lib/intelligence/flags`.
export type { WorkspaceFlag } from '@/lib/intelligence/flags';

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
