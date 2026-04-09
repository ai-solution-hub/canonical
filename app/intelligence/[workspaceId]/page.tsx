'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Rss,
  FileText,
  Settings2,
  Play,
  BarChart3,
  BookOpen,
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

export default function WorkspaceOverviewPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { role } = useUserRole();
  const isAdmin = role === 'admin';

  const [period, setPeriod] = useState('30d');
  const { data: metrics, isLoading: metricsLoading } = useIntelligenceMetrics(
    workspaceId,
    period,
  );
  const { data: workspace } = useIntelligenceWorkspace(workspaceId);
  const guideId = workspace?.domain_metadata?.guide_id;

  // Recent passed articles (last 5)
  const { data: passedData } = useFeedArticles(workspaceId, {
    tab: 'passed',
    page: 1,
    limit: 5,
  });

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

  return (
    <div className="space-y-6">
      {/* Pipeline health — surfaced first so failing pipelines are visible
          before performance metrics. */}
      <HealthPanel workspaceId={workspaceId} />

      {/* Metrics panel */}
      {metrics && (
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <MetricsPanel
            metrics={metrics}
            currentPeriod={period}
            onPeriodChange={setPeriod}
          />
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
                        {(article.relevance_score * 100).toFixed(0)}% relevant
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
              No unresolved flags. The scoring prompt is performing well.
            </p>
          )}
        </div>
      </div>

      {/* Quick actions */}
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
              <Link href={`/intelligence/${workspaceId}/prompts`}>
                <Settings2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Edit filter rules
              </Link>
            </Button>
          )}
          {guideId && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/guide">
                <BookOpen className="mr-1.5 size-3.5" aria-hidden="true" />
                View Intelligence Guide
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" disabled>
              <Play className="mr-1.5 size-3.5" aria-hidden="true" />
              Trigger Poll
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
