'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Rss, FileText, Settings2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MetricsPanel } from '@/components/intelligence/metrics-panel';
import { useIntelligenceMetrics } from '@/hooks/intelligence/use-intelligence-metrics';
import { useFeedArticles } from '@/hooks/intelligence/use-feed-articles';
import { useUserRole } from '@/hooks/use-user-role';

export default function WorkspaceOverviewPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { role } = useUserRole();
  const isAdmin = role === 'admin';

  const [period, setPeriod] = useState('30d');
  const { data: metrics, isLoading: metricsLoading } =
    useIntelligenceMetrics(workspaceId, period);

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
          {metrics && metrics.unresolved_flags > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-destructive">
                {metrics.unresolved_flags}
              </span>{' '}
              unresolved flag{metrics.unresolved_flags !== 1 ? 's' : ''} need
              attention.
            </p>
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
            <Link href={`/intelligence/${workspaceId}/prompts`}>
              <Settings2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Edit Prompt
            </Link>
          </Button>
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
