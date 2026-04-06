'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

/**
 * Pipeline-wide health summary returned by
 * `GET /api/intelligence/workspaces/:id/health`.
 *
 * Mirrors `PipelineHealthSummary` in `lib/intelligence/health.ts`.
 */
export interface PipelineHealth {
  /** ISO timestamp of the last successful pipeline run */
  lastSuccessfulRun: string | null;
  /** Milliseconds since the last successful run (null if never run) */
  timeSinceLastRunMs: number | null;
  /** Number of feed sources with at least one consecutive failure */
  sourcesWithFailures: number;
  /** Number of feed sources at or above the failure limit (10) */
  sourcesAtFailureLimit: number;
  /** Total active feed sources */
  totalActiveSources: number;
  /** Whether the pipeline is considered healthy */
  healthy: boolean;
  /** Human-readable status message */
  statusMessage: string;
}

/**
 * Per-source health entry — one row per active feed source in the workspace.
 *
 * Mirrors `SourceHealthEntry` in `lib/intelligence/health.ts`.
 */
export interface SourceHealthEntry {
  id: string;
  name: string;
  url: string;
  lastPolledAt: string | null;
  lastPolledStatus: string | null;
  lastPolledError: string | null;
  consecutiveFailures: number;
  pollingIntervalMinutes: number;
  articleCount: number;
}

/**
 * Workspace-scoped per-source health summary.
 *
 * Mirrors `SourceHealthSummary` in `lib/intelligence/health.ts`.
 */
export interface SourceHealthSummary {
  workspaceId: string;
  sources: SourceHealthEntry[];
  healthySources: number;
  failingSources: number;
  disabledSources: number;
}

/** Combined response shape from the workspace health endpoint. */
export interface WorkspaceHealthResponse {
  pipeline: PipelineHealth;
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
