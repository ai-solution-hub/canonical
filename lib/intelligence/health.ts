// lib/intelligence/health.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

type Supabase = SupabaseClient<Database>;

/** Overall pipeline health summary */
export interface PipelineHealthSummary {
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

/** Per-source health data */
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

/** Workspace source health summary */
export interface SourceHealthSummary {
  workspaceId: string;
  sources: SourceHealthEntry[];
  healthySources: number;
  failingSources: number;
  disabledSources: number;
}

/** Maximum consecutive failures before a source is considered at limit */
const FAILURE_LIMIT = 10;

/** Maximum time since last run before pipeline is considered unhealthy (24 hours) */
const MAX_HEALTHY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Get overall pipeline health status.
 *
 * Queries `si_processing_queue` for the last successful run and
 * `feed_sources` for failure counts across all workspaces.
 */
export async function getPipelineHealth(
  supabase: Supabase,
): Promise<PipelineHealthSummary> {
  // Get last successful pipeline run from processing queue
  const { data: lastRun } = await supabase
    .from('si_processing_queue')
    .select('completed_at')
    .eq('status', 'complete')
    .order('completed_at', { ascending: false })
    .limit(1);

  const lastSuccessfulRun = lastRun?.[0]?.completed_at ?? null;
  const timeSinceLastRunMs = lastSuccessfulRun
    ? Date.now() - new Date(lastSuccessfulRun).getTime()
    : null;

  // Count feed sources with failures
  const { data: allSources } = await supabase
    .from('feed_sources')
    .select('id, consecutive_failures, is_active')
    .eq('is_active', true);

  const sources = allSources ?? [];
  const totalActiveSources = sources.length;
  const sourcesWithFailures = sources.filter(
    (s) => s.consecutive_failures > 0,
  ).length;
  const sourcesAtFailureLimit = sources.filter(
    (s) => s.consecutive_failures >= FAILURE_LIMIT,
  ).length;

  // Determine overall health
  const neverRun = lastSuccessfulRun === null && totalActiveSources > 0;
  const stale =
    timeSinceLastRunMs !== null && timeSinceLastRunMs > MAX_HEALTHY_INTERVAL_MS;
  const tooManyFailures = sourcesAtFailureLimit > 0;

  const healthy = !neverRun && !stale && !tooManyFailures;

  let statusMessage = 'Pipeline is healthy';
  if (neverRun) {
    statusMessage = 'Pipeline has never completed a successful run';
  } else if (stale) {
    const hours = Math.round((timeSinceLastRunMs ?? 0) / (60 * 60 * 1000));
    statusMessage = `Pipeline has not run successfully in ${hours} hours`;
  } else if (tooManyFailures) {
    statusMessage = `${sourcesAtFailureLimit} source(s) at failure limit`;
  }

  return {
    lastSuccessfulRun,
    timeSinceLastRunMs,
    sourcesWithFailures,
    sourcesAtFailureLimit,
    totalActiveSources,
    healthy,
    statusMessage,
  };
}

/**
 * Get per-source health data for a specific workspace.
 */
export async function getSourceHealthSummary(
  supabase: Supabase,
  workspaceId: string,
): Promise<SourceHealthSummary> {
  const { data } = await supabase
    .from('feed_sources')
    .select(
      'id, name, url, last_polled_at, last_polled_status, last_polled_error, consecutive_failures, polling_interval_minutes, article_count, is_active',
    )
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('consecutive_failures', { ascending: false });

  const sources: SourceHealthEntry[] = (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    lastPolledAt: s.last_polled_at,
    lastPolledStatus: s.last_polled_status,
    lastPolledError: s.last_polled_error,
    consecutiveFailures: s.consecutive_failures,
    pollingIntervalMinutes: s.polling_interval_minutes,
    articleCount: s.article_count,
  }));

  const healthySources = sources.filter(
    (s) => s.consecutiveFailures === 0,
  ).length;
  const failingSources = sources.filter(
    (s) => s.consecutiveFailures > 0,
  ).length;
  const disabledSources = sources.filter(
    (s) => s.consecutiveFailures >= FAILURE_LIMIT,
  ).length;

  return {
    workspaceId,
    sources,
    healthySources,
    failingSources,
    disabledSources,
  };
}
