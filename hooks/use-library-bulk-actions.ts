'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
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
  onRefetch: () => void;
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
  onRefetch,
}: UseLibraryBulkActionsParams): UseLibraryBulkActionsReturn {
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOperating, setBulkOperating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress>({ current: 0, total: 0, label: '' });

  // Tag dialog state
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');

  // Assign dialog state
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [workspacesLoading, setWorkspacesLoading] = useState(false);

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
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

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === items.length && items.length > 0) {
        return new Set();
      }
      return new Set(items.map((i) => i.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- filterDeps is a dynamic array from the parent
  }, filterDeps);

  // Bulk operation runner
  const runBulkOperation = useCallback(
    async (
      label: string,
      operation: (id: string, item: ContentListItem) => Promise<boolean>,
    ) => {
      const ids = Array.from(selectedIds);
      setBulkOperating(true);
      setBulkProgress({ current: 0, total: ids.length, label });
      let successCount = 0;

      for (let i = 0; i < ids.length; i++) {
        const item = items.find((it) => it.id === ids[i]);
        if (!item) continue;

        try {
          const ok = await operation(ids[i], item);
          if (ok) successCount++;
        } catch {
          // continue processing remaining items
        }

        setBulkProgress({ current: i + 1, total: ids.length, label });
      }

      setBulkOperating(false);
      setBulkProgress({ current: 0, total: 0, label: '' });
      setSelectedIds(new Set());
      onRefetch();

      return successCount;
    },
    [selectedIds, items, onRefetch],
  );

  // Bulk re-classify
  const handleBulkReclassify = useCallback(async () => {
    const count = await runBulkOperation('Re-classifying', async (id) => {
      const res = await fetch(`/api/items/${id}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      return res.ok;
    });
    toast.success(`Re-classified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

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

    const count = await runBulkOperation('Tagging', async (id, item) => {
      const existing = (item.user_tags as string[] | null) ?? [];
      const merged = [...new Set([...existing, ...newTags])];
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'user_tags', value: merged }),
      });
      return res.ok;
    });
    toast.success(`Tagged ${count} item${count !== 1 ? 's' : ''} with: ${newTags.join(', ')}`);
  }, [tagInput, runBulkOperation]);

  // Bulk assign — opens dialog
  const handleBulkAssignOpen = useCallback(async () => {
    setSelectedWorkspaceId('');
    setAssignDialogOpen(true);
    setWorkspacesLoading(true);

    try {
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        const ws = Array.isArray(data) ? data : data.workspaces ?? [];
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

    const count = await runBulkOperation('Assigning', async (id) => {
      const res = await fetch(`/api/items/${id}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: selectedWorkspaceId, action: 'assign' }),
      });
      return res.ok;
    });
    const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
    toast.success(`Assigned ${count} item${count !== 1 ? 's' : ''} to "${ws?.name ?? 'workspace'}"`);
  }, [selectedWorkspaceId, workspaces, runBulkOperation]);

  // Bulk verify
  const handleBulkVerify = useCallback(async () => {
    const count = await runBulkOperation('Verifying', async (id) => {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, action: 'verify' }),
      });
      return res.ok;
    });
    toast.success(`Verified ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

  // Bulk delete (admin only)
  const handleBulkDelete = useCallback(async () => {
    const count = await runBulkOperation('Deleting', async (id) => {
      const res = await fetch(`/api/items/${id}`, {
        method: 'DELETE',
      });
      return res.ok;
    });
    toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
  }, [runBulkOperation]);

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
