'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import {
  useContentSelection,
  useContentBulkRunner,
} from '@/lib/content-browsing';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkspaceOption {
  id: string;
  name: string;
  type: string;
}

export interface BulkProgress {
  current: number;
  total: number;
  label: string;
}

export interface UseLibraryBulkActionsParams {
  items: ContentListItem[];
  filterDeps: unknown[];
  /** @deprecated No longer needed — bulk actions invalidate queries directly */
  onRefetch?: () => void;
}

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
  handleBulkReclassify: () => Promise<void>;
  handleBulkTagOpen: () => void;
  handleBulkTagConfirm: () => Promise<void>;
  handleBulkAssignOpen: () => Promise<void>;
  handleBulkAssignConfirm: () => Promise<void>;
  handleBulkVerify: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;

  // Tag dialog state
  tagDialogOpen: boolean;
  setTagDialogOpen: (open: boolean) => void;
  tagInput: string;
  setTagInput: (value: string) => void;

  // Assign dialog state
  assignDialogOpen: boolean;
  setAssignDialogOpen: (open: boolean) => void;
  workspaces: WorkspaceOption[];
  selectedWorkspaceId: string;
  setSelectedWorkspaceId: (id: string) => void;
  workspacesLoading: boolean;
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
  // Uses itemLookup for tag-merge case where operation needs item.user_tags
  const { bulkOperating, bulkProgress, runBulkOperation } =
    useContentBulkRunner<ContentListItem>(queryKeys.contentItems.all);

  // Adapt toggleSelectAll to close over items (preserves existing public API)
  const toggleSelectAll = useCallback(() => {
    sharedToggleSelectAll(items.map((i) => i.id));
  }, [items, sharedToggleSelectAll]);

  // Tag dialog state
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Assign dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // Item lookup for bulk runner (enables tag-merge at line 209 in original)
  const itemLookup = useCallback(
    (id: string) => items.find((it) => it.id === id),
    [items],
  );

  // Wrapper: run bulk op with selection clearing after
  const runWithClear = useCallback(
    async (
      label: string,
      operation: (id: string, item?: ContentListItem) => Promise<boolean>,
      needsLookup?: boolean,
    ) => {
      const ids = Array.from(selectedIds);
      const count = await runBulkOperation(
        label,
        ids,
        operation,
        needsLookup ? itemLookup : undefined,
      );
      clearSelection();
      return count;
    },
    [selectedIds, runBulkOperation, itemLookup, clearSelection],
  );

  // Bulk re-classify
  const handleBulkReclassify = useCallback(async () => {
    const count = await runWithClear('Re-classifying', async (id) => {
      const res = await fetch(`/api/items/${id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      return res.ok;
    });
    toast.success(`Re-classified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runWithClear]);

  // Bulk tag — opens dialog
  const handleBulkTagOpen = useCallback(() => {
    setTagInput('');
    setTagDialogOpen(true);
  }, []);

  const handleBulkTagConfirm = useCallback(async () => {
    const newTags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (newTags.length === 0) {
      toast.error('Enter at least one tag');
      return;
    }
    setTagDialogOpen(false);

    // Tag merge needs item.user_tags via itemLookup
    const count = await runWithClear(
      'Tagging',
      async (id, item) => {
        const existing = (item?.user_tags as string[] | null) ?? [];
        const merged = [...new Set([...existing, ...newTags])];
        const res = await fetch(`/api/items/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'user_tags', value: merged }),
        });
        return res.ok;
      },
      true, // needsLookup = true for tag merge
    );
    toast.success(
      `Tagged ${count} item${count !== 1 ? 's' : ''} with: ${newTags.join(', ')}`,
    );
  }, [tagInput, runWithClear]);

  // Bulk assign — opens dialog
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
          ws.map((w: { id: string; name: string; type?: string }) => ({
            id: w.id,
            name: w.name,
            type: w.type ?? 'kb_section',
          })),
        );
      }
    } catch {
      toast.error('Failed to load workspaces');
    } finally {
      setWorkspacesLoading(false);
    }
  }, []);

  const handleBulkAssignConfirm = useCallback(async () => {
    if (!selectedWorkspaceId) {
      toast.error('Select a workspace');
      return;
    }
    setAssignDialogOpen(false);

    const count = await runWithClear('Assigning', async (id) => {
      const res = await fetch(`/api/items/${id}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: selectedWorkspaceId,
          action: 'assign',
        }),
      });
      return res.ok;
    });
    const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
    toast.success(
      `Assigned ${count} item${count !== 1 ? 's' : ''} to "${ws?.name ?? 'workspace'}"`,
    );
  }, [selectedWorkspaceId, workspaces, runWithClear]);

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

  // Bulk delete (admin only)
  const handleBulkDelete = useCallback(async () => {
    const count = await runWithClear('Deleting', async (id) => {
      const res = await fetch(`/api/items/${id}`, {
        method: 'DELETE',
      });
      return res.ok;
    });
    toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
  }, [runWithClear]);

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    bulkOperating,
    bulkProgress,
    handleBulkReclassify,
    handleBulkTagOpen,
    handleBulkTagConfirm,
    handleBulkAssignOpen,
    handleBulkAssignConfirm,
    handleBulkVerify,
    handleBulkDelete,
    tagDialogOpen,
    setTagDialogOpen,
    tagInput,
    setTagInput,
    assignDialogOpen,
    setAssignDialogOpen,
    workspaces,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspacesLoading,
  };
}
