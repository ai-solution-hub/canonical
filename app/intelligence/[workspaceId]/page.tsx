'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Rss,
  FileText,
  Settings2,
  Play,
  BarChart3,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HealthPanel } from '@/components/intelligence/health-panel';
import { MetricsPanel } from '@/components/intelligence/metrics-panel';
import { RssFeedPanel } from '@/components/intelligence/rss-feed-panel';
import { useIntelligenceMetrics } from '@/hooks/intelligence/use-intelligence-metrics';
import { useIntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';
import { useFeedArticles } from '@/hooks/intelligence/use-feed-articles';
import { useUserRole } from '@/hooks/use-user-role';
import { useTriggerPoll } from '@/hooks/intelligence/use-trigger-poll';
import { getRelevanceLabel } from '@/lib/intelligence/relevance-display';
import type { MetricsSummary } from '@/hooks/intelligence/use-intelligence-metrics';

/**
 * Derive whether the current period is "quiet" — no new passed articles,
 * no unresolved flags, and no sources with errors.
 *
 * Returns `false` when metrics have not loaded yet to avoid a flash-collapse
 * on mount (show full layout until we know it is quiet).
 *
 * Ref: audit principle #8 — "silence is part of the UX".
 */
export function deriveIsQuietWeek(
  metrics: MetricsSummary | undefined,
): boolean {
  if (!metrics) return false;
  return (
    metrics.passed_articles === 0 &&
    metrics.unresolved_flags === 0 &&
    metrics.sources_with_errors === 0
  );
}

export default function WorkspaceOverviewPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { role } = useUserRole();
  const isAdmin = role === 'admin';
  const triggerPoll = useTriggerPoll(workspaceId);

  const { data: metrics, isLoading: metricsLoading } = useIntelligenceMetrics(
    workspaceId,
    '30d',
  );
  const { data: workspace } = useIntelligenceWorkspace(workspaceId);
  const guideId = workspace?.guide_id;

  // Recent passed articles (last 5)
  const { data: passedData } = useFeedArticles(workspaceId, {
    tab: 'passed',
    page: 1,
    limit: 5,
  });

  const isQuietWeek = deriveIsQuietWeek(metrics);

  if (metricsLoading) {
    return (
      <div role="status" aria-label="Loading workspace overview">
        <span className="sr-only">Loading...</span>
        <div className="space-y-4">
          <div className="h-48 animate-pulse rounded-lg border bg-card" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-lg border bg-card"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Shared detail sections: MetricsPanel, RssFeedPanel, Recent Passed,
  // Recent Flags. These are the low-signal sections collapsed during quiet
  // weeks. Extracted so the JSX is not duplicated across branches.
  const detailSections = (
    <>
      {/* Metrics panel */}
      {metrics && (
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <MetricsPanel metrics={metrics} />
        </div>
      )}

      {/* RSS Feed Panel */}
      {workspace && (
        <RssFeedPanel
          workspaceId={workspaceId}
          workspaceName={workspace.name}
        />
      )}

      {/* Content sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Passed Articles */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Recent Passed Articles
            </h3>
            <Link
              href={`/intelligence/${workspaceId}/articles`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              View all
            </Link>
          </div>
          {passedData?.articles.length ? (
            <div className="space-y-2">
              {passedData.articles.map((article) => (
                <a
                  key={article.id}
                  href={article.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border p-3 transition-colors hover:bg-accent/50"
                >
                  <p className="text-sm font-medium text-foreground line-clamp-1">
                    {article.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {article.source_name && (
                      <Badge variant="outline" className="text-[10px]">
                        {article.source_name}
                      </Badge>
                    )}
                    {article.relevance_score !== null && (
                      <span className="text-xs text-muted-foreground">
                        {getRelevanceLabel(article.relevance_score)}
                      </span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No passed articles yet. Articles will appear after the next
              pipeline poll.
            </p>
          )}
        </div>

        {/* Recent Flags / Unresolved */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Recent Flags
            </h3>
            <Link
              href={`/intelligence/${workspaceId}/articles`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Review articles
            </Link>
          </div>
          {metrics && metrics.recent_flags.length > 0 ? (
            <div className="space-y-2">
              {metrics.recent_flags.map((flag) => (
                <div key={flag.id} className="rounded-md border p-3">
                  <p className="text-sm font-medium text-foreground line-clamp-1">
                    {flag.article_title}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        flag.flag_type === 'false_positive'
                          ? 'text-destructive'
                          : 'text-warning'
                      }
                    >
                      {flag.flag_type === 'false_positive'
                        ? 'False positive'
                        : 'False negative'}
                    </Badge>
                    {flag.notes && (
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {flag.notes}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {metrics.unresolved_flags > 5 && (
                <p className="text-xs text-muted-foreground">
                  +{metrics.unresolved_flags - 5} more unresolved flag
                  {metrics.unresolved_flags - 5 !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No unresolved flags. No false positives or false negatives
              flagged.
            </p>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Pipeline health — always visible regardless of quiet state.
          Defence-in-depth: severity banner shows even if quiet conditions
          are met (which requires sources_with_errors === 0). */}
      <HealthPanel workspaceId={workspaceId} />

      {isQuietWeek ? (
        /* Quiet week: collapse low-signal sections behind a native <details>
           toggle. Uses HTML disclosure widget for built-in keyboard
           accessibility (Enter/Space to toggle, focusable <summary>).
           Ref: DECISIONS P1-14; audit principle #8. */
        <details
          className="group rounded-lg border bg-card shadow-sm"
          data-testid="quiet-week-collapse"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
            No new activity this period — expand for details
          </summary>
          <div className="space-y-6 px-4 pb-4" data-testid="quiet-week-details">
            {detailSections}
          </div>
        </details>
      ) : (
        /* Active week: render all sections expanded as before. */
        detailSections
      )}

      {/* Quick actions — always visible so Sarah can trigger a poll,
          navigate to Sources, or open the articles list. */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Quick Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/intelligence/${workspaceId}/sources`}>
              <Rss className="mr-1.5 size-3.5" aria-hidden="true" />
              Manage Sources
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/intelligence/${workspaceId}/articles`}>
              <FileText className="mr-1.5 size-3.5" aria-hidden="true" />
              Review Articles
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/intelligence/${workspaceId}/metrics`}>
              <BarChart3 className="mr-1.5 size-3.5" aria-hidden="true" />
              View Full Metrics
            </Link>
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/intelligence/${workspaceId}/filter-rules`}>
                <Settings2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Edit filter rules
              </Link>
            </Button>
          )}
          {guideId && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/coverage?tab=guides">
                <BookOpen className="mr-1.5 size-3.5" aria-hidden="true" />
                View Intelligence Guide
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              disabled={triggerPoll.isPending}
              onClick={() => triggerPoll.mutate()}
              title="Manually trigger the intelligence pipeline to poll all due sources now."
            >
              <Play className="mr-1.5 size-3.5" aria-hidden="true" />
              {triggerPoll.isPending ? 'Polling…' : 'Trigger Poll'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
