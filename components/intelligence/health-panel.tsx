'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useWorkspaceHealth } from '@/hooks/intelligence/use-workspace-health';
import type {
  PipelineHealth,
  SourceHealthEntry,
} from '@/hooks/intelligence/use-workspace-health';

interface HealthPanelProps {
  workspaceId: string;
}

/** Threshold above which "time since last run" is treated as stale (30 min). */
const STALE_RUN_MS = 30 * 60 * 1000;

/**
 * Backend pipeline status messages may leak implementation vocabulary
 * (model names, retrieval terms, classifier terms). Strip those from
 * user-facing copy — non-admin safety net. Admins can still inspect raw
 * messages via logs.
 */
const LEAK_PATTERNS =
  /\b(claude|sonnet|opus|haiku|anthropic|openai|gpt|llm|model|token|inference|classification|classifier|embedding|embed|vector|rag|prompt|scoring|relevance[_\s-]?score)\b/i;
function sanitisePipelineMessage(message: string | null | undefined): string {
  if (!message) return 'Pipeline status unavailable.';
  if (LEAK_PATTERNS.test(message)) {
    return 'Pipeline error — see admin logs.';
  }
  return message;
}

type HealthSeverity = 'healthy' | 'degraded' | 'failing';

/**
 * Derive overall severity from pipeline health.
 *
 * - failing: pipeline reports unhealthy OR any source is at the failure limit
 * - degraded: any source has failures (but none at the limit) OR run is stale
 * - healthy: everything green
 */
function deriveSeverity(pipeline: PipelineHealth): HealthSeverity {
  if (!pipeline.healthy || pipeline.sourcesAtFailureLimit > 0) return 'failing';
  const stale =
    pipeline.timeSinceLastRunMs !== null &&
    pipeline.timeSinceLastRunMs > STALE_RUN_MS;
  if (stale || pipeline.sourcesWithFailures > 0) return 'degraded';
  return 'healthy';
}

/** Format milliseconds as a relative duration like "12 minutes ago". */
function formatDurationAgo(ms: number | null): string {
  if (ms === null) return 'Never';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/** Format ISO timestamp as a relative duration. */
function formatRelativeFromIso(iso: string | null): string {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  return formatDurationAgo(ms);
}

interface SeverityVisuals {
  label: string;
  icon: typeof CheckCircle2;
  badgeClass: string;
  iconClass: string;
}

const SEVERITY_VISUALS: Record<HealthSeverity, SeverityVisuals> = {
  healthy: {
    label: 'Healthy',
    icon: CheckCircle2,
    badgeClass:
      'border-status-success/30 bg-status-success/10 text-status-success',
    iconClass: 'text-status-success',
  },
  degraded: {
    label: 'Degraded',
    icon: AlertTriangle,
    badgeClass:
      'border-status-warning/30 bg-status-warning/10 text-status-warning',
    iconClass: 'text-status-warning',
  },
  failing: {
    label: 'Failing',
    icon: XCircle,
    badgeClass: 'border-status-error/30 bg-status-error/10 text-status-error',
    iconClass: 'text-status-error',
  },
};

/**
 * HealthPanel — surfaces pipeline & per-source health for an intelligence
 * workspace. Shown above the metrics panel because failing pipelines must
 * be visible before performance numbers.
 */
export function HealthPanel({ workspaceId }: HealthPanelProps) {
  const [showSources, setShowSources] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } =
    useWorkspaceHealth(workspaceId);

  if (isLoading) {
    return (
      <div
        className="rounded-lg border bg-card p-4 shadow-sm"
        role="status"
        aria-label="Loading pipeline health"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-4 w-full max-w-md" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div
        className="rounded-lg border border-status-error/30 bg-status-error/5 p-4 shadow-sm"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <XCircle
            className="mt-0.5 size-5 shrink-0 text-status-error"
            aria-hidden="true"
          />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Could not load pipeline health
              </p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error
                  ? error.message
                  : 'An unknown error occurred while fetching health.'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                className={cn('mr-1.5 size-3.5', isFetching && 'animate-spin')}
                aria-hidden="true"
              />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { pipeline, sources } = data;
  const severity = deriveSeverity(pipeline);
  const visuals = SEVERITY_VISUALS[severity];
  const StatusIcon = visuals.icon;

  const isStale =
    pipeline.timeSinceLastRunMs !== null &&
    pipeline.timeSinceLastRunMs > STALE_RUN_MS;

  return (
    <section
      className={cn(
        'rounded-lg border bg-card p-4 shadow-sm',
        severity === 'failing' && 'border-status-error/40',
        severity === 'degraded' && 'border-status-warning/40',
      )}
      aria-labelledby="health-panel-heading"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusIcon
            className={cn('size-5', visuals.iconClass)}
            aria-hidden="true"
          />
          <h2
            id="health-panel-heading"
            className="text-sm font-semibold text-foreground"
          >
            Pipeline Health
          </h2>
        </div>
        <Badge
          variant="outline"
          className={cn('gap-1', visuals.badgeClass)}
          aria-label={`Status: ${visuals.label}`}
        >
          <StatusIcon className="size-3" aria-hidden="true" />
          {visuals.label}
        </Badge>
      </div>

      {/* Status message — both visible body and hover tooltip share the
          sanitised string so implementation vocabulary never reaches the user. */}
      {(() => {
        const sanitised = sanitisePipelineMessage(pipeline.statusMessage);
        return (
          <p className="mt-2 text-sm text-muted-foreground" title={sanitised}>
            {sanitised}
          </p>
        );
      })()}

      {/* Stats grid */}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Last successful run */}
        <div className="rounded-md border bg-background p-3">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden="true" />
            Last successful run
          </dt>
          <dd className="mt-1 text-sm font-semibold text-foreground">
            {formatRelativeFromIso(pipeline.lastSuccessfulRun)}
          </dd>
        </div>

        {/* Time since last run (with stale warning) */}
        <div
          className={cn(
            'rounded-md border bg-background p-3',
            isStale && 'border-status-warning/40 bg-status-warning/5',
          )}
        >
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isStale ? (
              <AlertTriangle
                className="size-3.5 text-status-warning"
                aria-hidden="true"
              />
            ) : (
              <Clock className="size-3.5" aria-hidden="true" />
            )}
            Time since last run
          </dt>
          <dd
            className={cn(
              'mt-1 text-sm font-semibold',
              isStale ? 'text-status-warning' : 'text-foreground',
            )}
          >
            {formatDurationAgo(pipeline.timeSinceLastRunMs)}
          </dd>
          {isStale && (
            <p className="mt-0.5 text-xs text-status-warning">
              Pipeline is stale
            </p>
          )}
        </div>

        {/* Sources with failures */}
        <div
          className={cn(
            'rounded-md border bg-background p-3',
            pipeline.sourcesWithFailures > 0 &&
              'border-status-warning/40 bg-status-warning/5',
          )}
        >
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle
              className={cn(
                'size-3.5',
                pipeline.sourcesWithFailures > 0
                  ? 'text-status-warning'
                  : 'text-muted-foreground',
              )}
              aria-hidden="true"
            />
            Sources with failures
          </dt>
          <dd
            className={cn(
              'mt-1 text-sm font-semibold',
              pipeline.sourcesWithFailures > 0
                ? 'text-status-warning'
                : 'text-foreground',
            )}
          >
            {pipeline.sourcesWithFailures}
          </dd>
        </div>

        {/* Sources at failure limit */}
        <div
          className={cn(
            'rounded-md border bg-background p-3',
            pipeline.sourcesAtFailureLimit > 0 &&
              'border-status-error/40 bg-status-error/5',
          )}
        >
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <XCircle
              className={cn(
                'size-3.5',
                pipeline.sourcesAtFailureLimit > 0
                  ? 'text-status-error'
                  : 'text-muted-foreground',
              )}
              aria-hidden="true"
            />
            At failure limit
          </dt>
          <dd
            className={cn(
              'mt-1 text-sm font-semibold',
              pipeline.sourcesAtFailureLimit > 0
                ? 'text-status-error'
                : 'text-foreground',
            )}
          >
            {pipeline.sourcesAtFailureLimit}
          </dd>
        </div>
      </dl>

      {/* Per-source breakdown toggle */}
      {sources.sources.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <button
            type="button"
            onClick={() => setShowSources((prev) => !prev)}
            aria-expanded={showSources}
            aria-controls="health-panel-source-list"
            className="flex w-full items-center justify-between rounded-md p-1 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
          >
            <span className="flex items-center gap-1.5">
              {showSources ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-4" aria-hidden="true" />
              )}
              Per-source breakdown
              <span className="ml-1 text-xs text-muted-foreground">
                ({sources.sources.length} active)
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {sources.healthySources} healthy
              {sources.failingSources > 0 &&
                ` · ${sources.failingSources} failing`}
            </span>
          </button>

          {showSources && (
            <ul
              id="health-panel-source-list"
              className="mt-3 space-y-2"
              data-testid="source-breakdown"
            >
              {sources.sources.map((source) => (
                <SourceHealthRow key={source.id} source={source} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Single per-source row inside the collapsible breakdown. */
function SourceHealthRow({ source }: { source: SourceHealthEntry }) {
  const failing = source.consecutiveFailures > 0;
  const atLimit = source.consecutiveFailures >= 10;

  let rowSeverity: HealthSeverity = 'healthy';
  if (atLimit) rowSeverity = 'failing';
  else if (failing) rowSeverity = 'degraded';

  const visuals = SEVERITY_VISUALS[rowSeverity];
  const StatusIcon = visuals.icon;

  return (
    <li
      className={cn(
        'rounded-md border bg-background p-3',
        atLimit && 'border-status-error/40',
        failing && !atLimit && 'border-status-warning/40',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <StatusIcon
              className={cn('size-3.5 shrink-0', visuals.iconClass)}
              aria-hidden="true"
            />
            <p className="truncate text-sm font-medium text-foreground">
              {source.name}
            </p>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {source.url}
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="text-muted-foreground">
            Last polled: {formatRelativeFromIso(source.lastPolledAt)}
          </p>
          {source.consecutiveFailures > 0 && (
            <p
              className={cn(
                'font-medium',
                atLimit ? 'text-status-error' : 'text-status-warning',
              )}
            >
              {source.consecutiveFailures} consecutive failure
              {source.consecutiveFailures !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
      {source.lastPolledError && (
        <p
          className={cn(
            'mt-2 rounded border p-2 text-xs',
            atLimit
              ? 'border-status-error/30 bg-status-error/5 text-status-error'
              : 'border-status-warning/30 bg-status-warning/5 text-status-warning',
          )}
        >
          {source.lastPolledError}
        </p>
      )}
    </li>
  );
}
