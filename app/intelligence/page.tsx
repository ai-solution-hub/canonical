'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, Building2, Newspaper } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import { useIntelligenceWorkspaces } from '@/hooks/intelligence/use-intelligence-workspaces';
import { IntelligenceWorkspaceCard } from '@/components/intelligence/intelligence-workspace-card';
import { WorkspaceCreationDialog } from '@/components/intelligence/workspace-creation-dialog';

export default function IntelligencePage() {
  const { canEdit, loading: roleLoading } = useUserRole();
  const { data: workspaces, isLoading, error } = useIntelligenceWorkspaces();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Role gate
  if (!roleLoading && !canEdit) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6">
        <Newspaper
          className="mx-auto mb-4 size-10 text-muted-foreground/50"
          aria-hidden="true"
        />
        <h2 className="text-lg font-semibold text-foreground">
          Access restricted
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You need editor or admin permissions to access intelligence management.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Intelligence"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Intelligence
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure and monitor AI-filtered sector and competitor intelligence
            feeds.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="shrink-0"
          >
            <Plus className="mr-1.5 size-4" />
            Create Workspace
          </Button>
        )}
      </div>

      {/* Quick link to profiles */}
      <div className="mt-4">
        <Link
          href="/intelligence/profiles"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Building2 className="size-3.5" aria-hidden="true" />
          Manage company profiles
        </Link>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg border bg-card"
              role="status"
              aria-label="Loading workspace"
            >
              <span className="sr-only">Loading...</span>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="mt-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Failed to load intelligence workspaces. Please try refreshing.
          </p>
        </div>
      )}

      {/* Workspace grid */}
      {!isLoading && !error && workspaces && (
        <>
          {workspaces.length === 0 ? (
            <div className="mt-12 text-center">
              <Newspaper
                className="mx-auto mb-4 size-10 text-muted-foreground/50"
                aria-hidden="true"
              />
              <h2 className="text-base font-medium text-foreground">
                No intelligence workspaces yet
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a company profile first, then set up your first
                intelligence stream.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button asChild variant="outline" size="sm">
                  <Link href="/intelligence/profiles">Create Profile</Link>
                </Button>
                <Button
                  onClick={() => setShowCreateDialog(true)}
                  size="sm"
                >
                  <Plus className="mr-1.5 size-4" />
                  Create Workspace
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((ws) => (
                <IntelligenceWorkspaceCard key={ws.id} workspace={ws} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Create workspace dialog */}
      <WorkspaceCreationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </section>
  );
}
