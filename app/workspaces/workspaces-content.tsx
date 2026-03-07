'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WorkspaceCard, type WorkspaceWithCounts } from '@/components/workspace-card';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';
import { WorkspaceDetailSheet } from '@/components/workspace-detail-sheet';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';
import type { Workspace } from '@/types/content';

const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'bid', label: 'Bids' },
  { value: 'kb_section', label: 'KB Sections' },
] as const;

interface WorkspacesContentProps {
  initialWorkspaces: Workspace[];
  initialCounts: Record<
    string,
    { item_count: number; last_activity: string | null }
  >;
}

function enrichWorkspaces(
  workspaces: Workspace[],
  counts: Record<string, { item_count: number; last_activity: string | null }>,
): WorkspaceWithCounts[] {
  return workspaces.map((p) => ({
    ...p,
    item_count: counts[p.id]?.item_count ?? 0,
    last_activity: counts[p.id]?.last_activity ?? null,
  }));
}

export function WorkspacesContent({
  initialWorkspaces,
  initialCounts,
}: WorkspacesContentProps) {
  const router = useRouter();
  const { canEdit, canAdmin } = useUserRole();
  const [workspaces, setWorkspaces] = useState<WorkspaceWithCounts[]>(() =>
    enrichWorkspaces(initialWorkspaces, initialCounts),
  );
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceWithCounts | null>(
    null,
  );
  const [showArchived, setShowArchived] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filteredWorkspaces = useMemo(
    () => typeFilter === 'all' ? workspaces : workspaces.filter((w) => w.type === typeFilter),
    [workspaces, typeFilter],
  );
  const activeWorkspaces = filteredWorkspaces.filter((p) => !p.is_archived);
  const archivedWorkspaces = filteredWorkspaces.filter((p) => p.is_archived);

  const handleCreated = useCallback((newWorkspace: Workspace) => {
    const enriched: WorkspaceWithCounts = {
      ...newWorkspace,
      item_count: 0,
      last_activity: null,
    };
    setWorkspaces((prev) =>
      [...prev, enriched].sort((a, b) => a.name.localeCompare(b.name)),
    );
  }, []);

  const handleUpdated = useCallback((updated: WorkspaceWithCounts) => {
    setWorkspaces((prev) =>
      prev
        .map((p) => (p.id === updated.id ? updated : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditWorkspace((prev) =>
      prev?.id === updated.id ? updated : prev,
    );
  }, []);

  const handleArchiveToggle = useCallback(
    async (workspace: WorkspaceWithCounts) => {
      const newArchived = !workspace.is_archived;
      const label = newArchived ? 'Archived' : 'Unarchived';

      // Optimistic update
      setWorkspaces((prev) =>
        prev.map((p) =>
          p.id === workspace.id ? { ...p, is_archived: newArchived } : p,
        ),
      );

      try {
        const res = await fetch(`/api/workspaces/${workspace.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_archived: newArchived }),
        });
        if (!res.ok) throw new Error();

        toast(`${label} "${workspace.name}"`, {
          duration: 3000,
          action: {
            label: 'Undo',
            onClick: async () => {
              // Revert
              setWorkspaces((prev) =>
                prev.map((p) =>
                  p.id === workspace.id
                    ? { ...p, is_archived: !newArchived }
                    : p,
                ),
              );
              await fetch(`/api/workspaces/${workspace.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_archived: !newArchived }),
              });
            },
          },
        });
      } catch (err) {
        console.error(`Failed to ${label.toLowerCase()} workspace:`, err);
        // Rollback
        setWorkspaces((prev) =>
          prev.map((p) =>
            p.id === workspace.id ? { ...p, is_archived: !newArchived } : p,
          ),
        );
        toast.error(`Failed to ${label.toLowerCase()} workspace`);
      }
    },
    [],
  );

  const handleDeleted = useCallback((workspaceId: string) => {
    setWorkspaces((prev) => prev.filter((p) => p.id !== workspaceId));
  }, []);

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-fluid-2xl font-bold tracking-tight">Workspaces</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your workspace collections.
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => setShowCreateDialog(true)}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            New Workspace
          </Button>
        )}
      </div>

      {/* Type filter */}
      <div className="mt-4 flex gap-1" role="tablist" aria-label="Filter workspaces by type">
        {TYPE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={typeFilter === value}
            onClick={() => setTypeFilter(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              typeFilter === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Active workspaces */}
      <section className="mt-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Active Workspaces ({activeWorkspaces.length})
        </h2>

        {activeWorkspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <FolderOpen className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No workspaces yet. Create your first workspace to start organising
              content.
            </p>
            {canEdit && (
              <Button
                variant="outline"
                className="mt-4 gap-1.5"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="size-4" />
                Create Workspace
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeWorkspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onEdit={(ws) => {
                  if (ws.type === 'bid') {
                    router.push(`/bid/${ws.id}`);
                  } else {
                    setEditWorkspace(ws);
                  }
                }}
                onArchiveToggle={handleArchiveToggle}
                readOnly={!canEdit}
              />
            ))}
          </div>
        )}
      </section>

      {/* Archived workspaces */}
      {archivedWorkspaces.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            aria-expanded={showArchived}
            aria-controls="archived-workspaces"
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {showArchived ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Archived Workspaces ({archivedWorkspaces.length})
          </button>

          {showArchived && (
            <div id="archived-workspaces" className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {archivedWorkspaces.map((workspace) => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  onEdit={(ws) => {
                  if (ws.type === 'bid') {
                    router.push(`/bid/${ws.id}`);
                  } else {
                    setEditWorkspace(ws);
                  }
                }}
                  onArchiveToggle={handleArchiveToggle}
                  readOnly={!canEdit}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Create dialog */}
      <WorkspaceCreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreated}
      />

      {/* Detail sheet */}
      <WorkspaceDetailSheet
        workspace={editWorkspace}
        open={!!editWorkspace}
        onOpenChange={(v) => {
          if (!v) setEditWorkspace(null);
        }}
        onUpdated={handleUpdated}
        onArchiveToggle={handleArchiveToggle}
        onDeleted={handleDeleted}
        readOnly={!canEdit}
        isAdmin={canAdmin}
      />
    </>
  );
}
