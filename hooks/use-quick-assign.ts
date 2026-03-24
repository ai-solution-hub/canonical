'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { isActive } from '@/lib/bid-state-machine';
import type { BidState } from '@/types/bid';
import type { Workspace } from '@/types/content';

export interface ActiveBidWorkspace {
  id: string;
  name: string;
  color: string;
  deadline: string | null;
}

export interface UseQuickAssignReturn {
  /** Active bid workspaces (fetched once, cached) */
  activeWorkspaces: ActiveBidWorkspace[];
  /** Map of item ID to set of assigned workspace IDs */
  itemAssignments: Map<string, Set<string>>;
  /** Loading state for workspace list */
  isLoadingWorkspaces: boolean;
  /** Toggle assignment — assigns if not assigned, unassigns if assigned */
  toggleAssignment: (itemId: string, workspaceId: string, workspaceName: string) => Promise<void>;
  /** Loading state per item (for spinner on button) */
  isAssigning: (itemId: string) => boolean;
  /** Fetch assignments for a batch of item IDs (called when items load) */
  loadAssignments: (itemIds: string[]) => Promise<void>;
}

function filterActiveBids(workspaces: Workspace[]): ActiveBidWorkspace[] {
  return workspaces
    .filter((ws) => {
      if (ws.type !== 'bid') return false;
      const meta = ws.domain_metadata as { status?: string; deadline?: string } | null;
      if (!meta?.status) return false;
      return isActive(meta.status as BidState);
    })
    .map((ws) => {
      const meta = ws.domain_metadata as { deadline?: string } | null;
      return {
        id: ws.id,
        name: ws.name,
        color: ws.color,
        deadline: meta?.deadline ?? null,
      };
    })
    .sort((a, b) => {
      // Soonest deadline first, nulls last
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline && !b.deadline) return -1;
      if (!a.deadline && b.deadline) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function useQuickAssign(): UseQuickAssignReturn {
  const [activeWorkspaces, setActiveWorkspaces] = useState<ActiveBidWorkspace[]>([]);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [itemAssignments, setItemAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [assigningItems, setAssigningItems] = useState<Set<string>>(new Set());
  const fetchedRef = useRef(false);

  // Fetch active workspaces once on mount
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchWorkspaces() {
      try {
        const res = await fetch('/api/workspaces');
        if (!res.ok) {
          console.error('Failed to fetch workspaces:', res.status);
          return;
        }
        const data = await res.json();
        const workspaces = Array.isArray(data) ? data : (data.workspaces ?? []);
        setActiveWorkspaces(filterActiveBids(workspaces));
      } catch (err) {
        console.error('Failed to fetch workspaces:', err);
      } finally {
        setIsLoadingWorkspaces(false);
      }
    }

    fetchWorkspaces();
  }, []);

  const loadAssignments = useCallback(async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    try {
      const res = await fetch('/api/items/batch-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      if (!res.ok) {
        console.error('Failed to load assignments:', res.status);
        return;
      }
      const { assignments } = await res.json() as { assignments: Record<string, string[]> };

      setItemAssignments((prev) => {
        const next = new Map(prev);
        // Set all requested items — those not in response have no assignments
        for (const id of itemIds) {
          next.set(id, new Set(assignments[id] ?? []));
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  }, []);

  const toggleAssignment = useCallback(async (
    itemId: string,
    workspaceId: string,
    workspaceName: string,
  ) => {
    const currentAssignments = itemAssignments.get(itemId) ?? new Set<string>();
    const isCurrentlyAssigned = currentAssignments.has(workspaceId);
    const action = isCurrentlyAssigned ? 'unassign' : 'assign';

    // Optimistic update
    setItemAssignments((prev) => {
      const next = new Map(prev);
      const itemSet = new Set(prev.get(itemId) ?? []);
      if (action === 'assign') {
        itemSet.add(workspaceId);
      } else {
        itemSet.delete(workspaceId);
      }
      next.set(itemId, itemSet);
      return next;
    });

    setAssigningItems((prev) => new Set(prev).add(itemId));

    try {
      const res = await fetch(`/api/items/${itemId}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, action }),
      });

      if (!res.ok) {
        // Rollback
        setItemAssignments((prev) => {
          const next = new Map(prev);
          const itemSet = new Set(prev.get(itemId) ?? []);
          if (action === 'assign') {
            itemSet.delete(workspaceId);
          } else {
            itemSet.add(workspaceId);
          }
          next.set(itemId, itemSet);
          return next;
        });
        toast.error(`Failed to ${action} workspace`);
        return;
      }

      const toastMessage = action === 'assign'
        ? `Added to ${workspaceName}`
        : `Removed from ${workspaceName}`;

      toast(toastMessage, {
        duration: 4000,
        action: {
          label: 'Undo',
          onClick: () => {
            // Undo: perform the reverse action
            toggleAssignment(itemId, workspaceId, workspaceName);
          },
        },
      });
    } catch {
      // Rollback
      setItemAssignments((prev) => {
        const next = new Map(prev);
        const itemSet = new Set(prev.get(itemId) ?? []);
        if (action === 'assign') {
          itemSet.delete(workspaceId);
        } else {
          itemSet.add(workspaceId);
        }
        next.set(itemId, itemSet);
        return next;
      });
      toast.error(`Failed to ${action} workspace`);
    } finally {
      setAssigningItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, [itemAssignments]);

  const isAssigning = useCallback(
    (itemId: string) => assigningItems.has(itemId),
    [assigningItems],
  );

  return {
    activeWorkspaces,
    itemAssignments,
    isLoadingWorkspaces,
    toggleAssignment,
    isAssigning,
    loadAssignments,
  };
}
