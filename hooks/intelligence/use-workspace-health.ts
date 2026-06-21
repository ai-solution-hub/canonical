'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type {
  PipelineHealthSummary,
  SourceHealthSummary,
} from '@/lib/intelligence/health';

// Re-export the canonical health shapes (defined in `@/lib/intelligence/health`)
// under the names this hook's consumers already import. Single source of truth
// lives in the server module; these were previously hand-mirrored here.
export type {
  PipelineHealthSummary as PipelineHealth,
  SourceHealthEntry,
  SourceHealthSummary,
} from '@/lib/intelligence/health';

/** Combined response shape from the workspace health endpoint. */
export interface WorkspaceHealthResponse {
  pipeline: PipelineHealthSummary;
  sources: SourceHealthSummary;
}

/**
 * Fetches pipeline + per-source health for an intelligence workspace.
 *
 * - Refetches every 60s so the dashboard reflects fresh poll outcomes.
 * - 30s stale time means navigating between sub-routes won't trigger a
 *   refetch storm.
 */
export function useWorkspaceHealth(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.intelligence.health.workspace(workspaceId),
    queryFn: () =>
      fetchJson<WorkspaceHealthResponse>(
        `/api/intelligence/workspaces/${workspaceId}/health`,
      ),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
