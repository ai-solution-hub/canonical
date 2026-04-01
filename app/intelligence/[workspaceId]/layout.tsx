'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Newspaper } from 'lucide-react';
import { useIntelligenceWorkspace } from '@/hooks/intelligence/use-intelligence-workspaces';
import { WorkspaceSubNav } from '@/components/intelligence/workspace-sub-nav';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const workspaceId = params.workspaceId as string;
  const { data: workspace, isLoading } = useIntelligenceWorkspace(workspaceId);

  return (
    <section
      aria-label="Intelligence workspace"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      {/* Back link */}
      <Link
        href="/intelligence"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to Intelligence
      </Link>

      {/* Workspace header */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Newspaper
            className="size-5 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          {isLoading ? (
            <div className="h-7 w-48 animate-pulse rounded bg-accent" />
          ) : (
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {workspace?.name ?? 'Workspace'}
            </h1>
          )}
        </div>
        {workspace?.company_profile_name && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {workspace.company_profile_name}
          </p>
        )}
      </div>

      {/* Sub-navigation */}
      <WorkspaceSubNav workspaceId={workspaceId} />

      {/* Page content */}
      <div className="mt-6">{children}</div>
    </section>
  );
}
