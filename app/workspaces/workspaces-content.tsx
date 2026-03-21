'use client';

import { useState, useCallback, useMemo } from 'react';
import { handleTablistKeyDown } from '@/lib/tablist-keyboard';
import { useRouter } from 'next/navigation';
import { Plus, ChevronDown, ChevronRight, FolderOpen, Archive, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { WorkspaceCard, type WorkspaceWithCounts } from '@/components/workspace-card';
import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';
import { WorkspaceDetailSheet } from '@/components/workspace-detail-sheet';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  loadError?: string;
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
  loadError,
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

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
              // Optimistic revert
              setWorkspaces((prev) =>
                prev.map((p) =>
                  p.id === workspace.id
                    ? { ...p, is_archived: !newArchived }
                    : p,
                ),
              );
              try {
                const undoRes = await fetch(`/api/workspaces/${workspace.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ is_archived: !newArchived }),
                });
                if (!undoRes.ok) throw new Error();
              } catch {
                // Rollback the optimistic revert on failure
                setWorkspaces((prev) =>
                  prev.map((p) =>
                    p.id === workspace.id
                      ? { ...p, is_archived: newArchived }
                      : p,
                  ),
                );
                toast.error('Failed to undo. Please try again.');
              }
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
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(workspaceId);
      return next;
    });
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkArchive = useCallback(async () => {
    setBulkProcessing(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_archived: true }),
          }),
        ),
      );
      const failedCount = results.filter((r) => !r.ok).length;
      if (failedCount > 0) {
        toast.error(`Failed to archive ${failedCount} of ${ids.length} workspace${ids.length !== 1 ? 's' : ''}`);
      }
      const succeededIds = new Set(ids.filter((_, i) => results[i].ok));
      setWorkspaces((prev) =>
        prev.map((w) => (succeededIds.has(w.id) ? { ...w, is_archived: true } : w)),
      );
      if (succeededIds.size > 0) {
        toast.success(`Archived ${succeededIds.size} workspace${succeededIds.size !== 1 ? 's' : ''}`);
      }
      clearSelection();
    } catch {
      toast.error('Failed to archive some workspaces');
    } finally {
      setBulkProcessing(false);
    }
  }, [selectedIds, clearSelection]);

  const handleBulkDelete = useCallback(async () => {
    setBulkProcessing(true);
    const ids = Array.from(selectedIds);
    try {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/workspaces/${id}`, { method: 'DELETE' }),
        ),
      );
      const failedCount = results.filter((r) => !r.ok).length;
      if (failedCount > 0) {
        toast.error(`Failed to delete ${failedCount} of ${ids.length} workspace${ids.length !== 1 ? 's' : ''}`);
      }
      const succeededIds = new Set(ids.filter((_, i) => results[i].ok));
      setWorkspaces((prev) => prev.filter((w) => !succeededIds.has(w.id)));
      if (succeededIds.size > 0) {
        toast.success(`Deleted ${succeededIds.size} workspace${succeededIds.size !== 1 ? 's' : ''}`);
      }
      clearSelection();
    } catch {
      toast.error('Failed to delete some workspaces');
    } finally {
      setBulkProcessing(false);
      setBulkDeleteOpen(false);
    }
  }, [selectedIds, clearSelection]);

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
            <Plus className="size-4" aria-hidden="true" />
            New Workspace
          </Button>
        )}
      </div>

      {/* Type filter */}
      <div className="mt-4 flex gap-1" role="tablist" aria-label="Filter workspaces by type" onKeyDown={handleTablistKeyDown}>
        {TYPE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`workspace-tab-${value}`}
            aria-selected={typeFilter === value}
            aria-controls="workspace-tabpanel"
            tabIndex={typeFilter === value ? 0 : -1}
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

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && canEdit && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border bg-card px-4 py-2" role="toolbar" aria-label="Bulk actions" aria-live="polite">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={bulkProcessing}
              onClick={handleBulkArchive}
            >
              <Archive className="size-3.5" aria-hidden="true" />
              Archive
            </Button>
            {canAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
                disabled={bulkProcessing}
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Delete
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearSelection}
            aria-label="Clear selection"
            className="ml-auto"
          >
            <X className="size-4" />
          </Button>
        </div>
      )}

      {/* Active workspaces */}
      <section id="workspace-tabpanel" role="tabpanel" aria-labelledby={`workspace-tab-${typeFilter}`} className="mt-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Active Workspaces ({activeWorkspaces.length})
        </h2>

        {loadError ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 py-12 text-center" role="alert">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.refresh()}
            >
              Retry
            </Button>
          </div>
        ) : activeWorkspaces.length === 0 ? (
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
              <div key={workspace.id} className="group/select relative">
                {canEdit && (
                  <div className={cn(
                    'absolute left-2 top-2 z-10 transition-opacity',
                    selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/select:opacity-100 group-focus-within/select:opacity-100',
                  )}>
                    <Checkbox
                      checked={selectedIds.has(workspace.id)}
                      onCheckedChange={() => toggleSelection(workspace.id)}
                      aria-label={`Select ${workspace.name}`}
                    />
                  </div>
                )}
                <WorkspaceCard
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
              </div>
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
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                <div key={workspace.id} className="group/select relative">
                  {canEdit && (
                    <div className={cn(
                      'absolute left-2 top-2 z-10 transition-opacity',
                      selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover/select:opacity-100 group-focus-within/select:opacity-100',
                    )}>
                      <Checkbox
                        checked={selectedIds.has(workspace.id)}
                        onCheckedChange={() => toggleSelection(workspace.id)}
                        aria-label={`Select ${workspace.name}`}
                      />
                    </div>
                  )}
                  <WorkspaceCard
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
                </div>
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

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} workspace{selectedIds.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected workspace{selectedIds.size !== 1 ? 's' : ''} and
              cannot be undone. Content items within will be unlinked but not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkProcessing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              disabled={bulkProcessing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
