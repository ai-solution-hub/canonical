'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import {
  useContentSelection,
  useContentBulkRunner,
  type BulkProgress,
} from '@/lib/content-browsing';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseLibraryBulkActionsParams {
  items: ContentListItem[];
  filterDeps: unknown[];
  /** @deprecated No longer needed — bulk actions invalidate queries directly */
  onRefetch?: () => void;
}

interface WorkspaceOption {
  id: string;
  name: string;
  type: string | null;
}

/**
 * ID-139 {139.9} retired Reclassify/Tag/Assign/Delete — they targeted the
 * deleted items-detail route tree (ID-131 {131.17} removed the
 * `content_items` model) with no live 1:1 replacement, deferring "per-pair
 * bulk-actions parity" to id-135 {135.22}.
 *
 * {135.22} rebind: Assign-to-workspace and Delete are restored here, against
 * the q_a_pairs model. Reclassify and Tag are DELIBERATELY NOT restored —
 * schema inspection confirms `q_a_pairs` has no domain/subtopic
 * classification columns and no free-form user-tag column (`scope_tag`/
 * `anti_scope_tag` are a distinct ontology-matching concern consumed by
 * search/OKF, not a repurposable tag field) — there is no valid backing
 * model for either action on this table, matching the same conclusion
 * {139.9} and the earlier `bl-405` orphan-cluster deletion independently
 * reached. `handleBulkVerify` is unchanged (still targets
 * `/api/review/action`, unaffected by this rebind).
 *
 * @public
 */
export interface UseLibraryBulkActionsReturn {
  // Selection state
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;

  // Bulk operation state
  bulkOperating: boolean;
  bulkProgress: BulkProgress;

  // Bulk action handlers
  handleBulkVerify: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;

  // Assign-to-workspace dialog state + handlers
  assignDialogOpen: boolean;
  setAssignDialogOpen: (open: boolean) => void;
  workspaces: WorkspaceOption[];
  workspacesLoading: boolean;
  selectedWorkspaceId: string;
  setSelectedWorkspaceId: (id: string) => void;
  handleBulkAssignOpen: () => Promise<void>;
  handleBulkAssignConfirm: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLibraryBulkActions({
  items,
  filterDeps,
}: UseLibraryBulkActionsParams): UseLibraryBulkActionsReturn {
  // Shared selection state — delegates to lib/content-browsing
  const {
    selectedIds,
    toggleSelect,
    toggleSelectAll: sharedToggleSelectAll,
    clearSelection,
  } = useContentSelection(filterDeps);

  // Shared bulk runner — delegates to lib/content-browsing
  const { bulkOperating, bulkProgress, runBulkOperation } =
    useContentBulkRunner<ContentListItem>(queryKeys.contentItems.all);

  // Adapt toggleSelectAll to close over items (preserves existing public API)
  const toggleSelectAll = useCallback(() => {
    sharedToggleSelectAll(items.map((i) => i.id));
  }, [items, sharedToggleSelectAll]);

  // Wrapper: run bulk op with selection clearing after
  const runWithClear = useCallback(
    async (
      label: string,
      operation: (id: string, item?: ContentListItem) => Promise<boolean>,
    ) => {
      const ids = Array.from(selectedIds);
      const count = await runBulkOperation(label, ids, operation);
      clearSelection();
      return count;
    },
    [selectedIds, runBulkOperation, clearSelection],
  );

  // Bulk verify
  const handleBulkVerify = useCallback(async () => {
    const count = await runWithClear('Verifying', async (id) => {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, action: 'verify' }),
      });
      return res.ok;
    });
    toast.success(`Verified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runWithClear]);

  // Bulk delete — hard DELETE against q_a_pairs (ID-135 {135.22}); the route
  // itself enforces the admin-only role gate.
  const handleBulkDelete = useCallback(async () => {
    const count = await runWithClear('Deleting', async (id) => {
      const res = await fetch(`/api/q-a-pairs/${id}`, { method: 'DELETE' });
      return res.ok;
    });
    toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
  }, [runWithClear]);

  // Assign-to-workspace dialog state (ID-135 {135.22} S449 addendum)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  const handleBulkAssignOpen = useCallback(async () => {
    setSelectedWorkspaceId('');
    setAssignDialogOpen(true);
    setWorkspacesLoading(true);

    try {
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        const ws = Array.isArray(data) ? data : (data.workspaces ?? []);
        setWorkspaces(
          ws.map((w: { id: string; name: string; type?: string | null }) => ({
            id: w.id,
            name: w.name,
            type: w.type ?? null,
          })),
        );
      }
    } catch {
      toast.error('Failed to load workspaces');
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  // Assign to workspace — PATCHes q_a_pairs.source_workspace_id (the post-M6
  // single-FK membership grain; there is no junction table) via the
  // dedicated app/api/q-a-pairs/[id]/workspace route.
  const handleBulkAssignConfirm = useCallback(async () => {
    if (!selectedWorkspaceId) {
      toast.error('Select a workspace');
      return;
    }
    setAssignDialogOpen(false);

    const count = await runWithClear('Assigning', async (id) => {
      const res = await fetch(`/api/q-a-pairs/${id}/workspace`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_workspace_id: selectedWorkspaceId }),
      });
      return res.ok;
    });
    toast.success(
      `Assigned ${count} item${count !== 1 ? 's' : ''} to a workspace`,
    );
  }, [selectedWorkspaceId, runWithClear]);

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    bulkOperating,
    bulkProgress,
    handleBulkVerify,
    handleBulkDelete,
    assignDialogOpen,
    setAssignDialogOpen,
    workspaces,
    workspacesLoading,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    handleBulkAssignOpen,
    handleBulkAssignConfirm,
  };
}
