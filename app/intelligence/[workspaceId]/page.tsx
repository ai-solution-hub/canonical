'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Rss, FileText, Settings2 } from 'lucide-react';
import { useIntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';
import { useFeedSources } from '@/hooks/intelligence/use-feed-sources';

export default function WorkspaceOverviewPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { data: workspace, isLoading: wsLoading } =
    useIntelligenceWorkspace(workspaceId);
  const { data: sources, isLoading: sourcesLoading } =
    useFeedSources(workspaceId);

  if (wsLoading) {
    return (
      <div role="status" aria-label="Loading workspace overview">
        <span className="sr-only">Loading...</span>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  const activeSourceCount =
    sources?.filter((s) => s.is_active).length ?? 0;
  const totalSourceCount = sources?.length ?? 0;
  const articleCount = workspace?.article_count ?? 0;
  const passedCount = workspace?.passed_article_count ?? 0;

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link
          href={`/intelligence/${workspaceId}/sources`}
          className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Rss className="size-4" aria-hidden="true" />
            Feed Sources
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {sourcesLoading ? '...' : activeSourceCount}
          </p>
          <p className="text-xs text-muted-foreground">
            {totalSourceCount > activeSourceCount
              ? `${totalSourceCount - activeSourceCount} archived`
              : 'active'}
          </p>
        </Link>

        <Link
          href={`/intelligence/${workspaceId}/articles`}
          className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <FileText className="size-4" aria-hidden="true" />
            Articles
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {passedCount}
          </p>
          <p className="text-xs text-muted-foreground">
            passed of {articleCount} total
          </p>
        </Link>

        <Link
          href={`/intelligence/${workspaceId}/prompts`}
          className="rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Settings2 className="size-4" aria-hidden="true" />
            Scoring Prompt
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">Active</p>
          <p className="text-xs text-muted-foreground">
            Configure relevance criteria
          </p>
        </Link>
      </div>

      {/* Description */}
      {workspace?.description && (
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-medium text-muted-foreground">
            Description
          </h2>
          <p className="mt-1 text-sm text-foreground">
            {workspace.description}
          </p>
        </div>
      )}
    </div>
  );
}
