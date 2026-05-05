'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Newspaper, Rss, FileText, ArrowRight } from 'lucide-react';
import type { IntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';

interface IntelligenceWorkspaceCardProps {
  workspace: IntelligenceWorkspace;
}

function subscribeToClientMount(onStoreChange: () => void) {
  onStoreChange();
  return () => {};
}

function getClientMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date(Date.now());
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

export function IntelligenceWorkspaceCard({
  workspace,
}: IntelligenceWorkspaceCardProps) {
  const mounted = useSyncExternalStore(
    subscribeToClientMount,
    getClientMountedSnapshot,
    getServerMountedSnapshot,
  );
  const articleCount = workspace.article_count ?? 0;
  const passedCount = workspace.passed_article_count ?? 0;
  const sourceCount = workspace.source_count ?? 0;

  if (!mounted) return null;

  return (
    <Link
      href={`/intelligence/${workspace.id}`}
      className="group block rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Newspaper
              className="size-4 shrink-0 text-success"
              aria-hidden="true"
            />
            <h3 className="truncate text-base font-semibold text-foreground">
              {workspace.name}
            </h3>
          </div>
          {workspace.company_profile_name && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {workspace.company_profile_name}
            </p>
          )}
        </div>
        <ArrowRight
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </div>

      {workspace.description && (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {workspace.description}
        </p>
      )}

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Rss className="size-3" aria-hidden="true" />
          {sourceCount} source{sourceCount !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="size-3" aria-hidden="true" />
          {passedCount}/{articleCount} passed
        </span>
        <span className="ml-auto">
          {formatRelativeTime(workspace.updated_at)}
        </span>
      </div>
    </Link>
  );
}
