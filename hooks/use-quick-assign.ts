'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import { isActive } from '@/lib/procurement/procurement-workflow';
import type { BidState } from '@/types/procurement';
import type { Workspace } from '@/types/content';

export interface ActiveBidWorkspace {
  id: string;
  name: string;
  color: string;
  deadline: string | null;
}

/** @public */
export interface UseQuickAssignReturn {
  /** Active bid workspaces (fetched once, cached) */
  activeWorkspaces: ActiveBidWorkspace[];
  /** Map of item ID to set of assigned workspace IDs */
  itemAssignments: Map<string, Set<string>>;
  /** Loading state for workspace list */
  isLoadingWorkspaces: boolean;
  /** Toggle assignment — assigns if not assigned, unassigns if assigned */
  toggleAssignment: (
    itemId: string,
    workspaceId: string,
    workspaceName: string,
  ) => Promise<void>;
  /** Loading state per item (for spinner on button) */
  isAssigning: (itemId: string) => boolean;
  /** Fetch assignments for a batch of item IDs (called when items load) */
  loadAssignments: (itemIds: string[]) => Promise<void>;
}

function filterActiveBids(workspaces: Workspace[]): ActiveBidWorkspace[] {
  return workspaces
    .filter((ws) => {
      if (ws.type !== 'bid') return false;
      const meta = ws.domain_metadata as {
        status?: string;
        deadline?: string;
      } | null;
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

// ---------------------------------------------------------------------------
// Mutation variable types
// ---------------------------------------------------------------------------

interface ToggleVariables {
  itemId: string;
  workspaceId: string;
  workspaceName: string;
  action: 'assign' | 'unassign';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useQuickAssign(): UseQuickAssignReturn {
  // Item assignments stay as Map — populated imperatively via loadAssignments
  const [itemAssignments, setItemAssignments] = useState<
    Map<string, Set<string>>
  >(new Map());
  // Per-item assigning state for spinner
  const [assigningItems, setAssigningItems] = useState<Set<string>>(new Set());

  // -------------------------------------------------------------------------
  // Workspace query — replaces useEffect + fetchedRef
  // -------------------------------------------------------------------------

  const workspacesQuery = useQuery<Workspace[], Error, ActiveBidWorkspace[]>({
    queryKey: queryKeys.workspaces.list,
    queryFn: async () => {
      const data = await fetchJson<Workspace[] | { workspaces: Workspace[] }>(
        '/api/workspaces',
      );
      return Array.isArray(data) ? data : (data.workspaces ?? []);
    },
    select: filterActiveBids,
    staleTime: 5 * 60 * 1000, // Workspaces rarely change
  });

  // -------------------------------------------------------------------------
  // Load assignments — imperative POST to fetch batch assignments
  // -------------------------------------------------------------------------

  const loadAssignmentsMutation = useMutation<
    Record<string, string[]>,
    Error,
    string[]
  >({
    mutationFn: async (itemIds: string[]) => {
      const data = await mutationFetchJson<{
        assignments: Record<string, string[]>;
      }>('/api/items/batch-workspaces', { item_ids: itemIds });
      return data.assignments;
    },
  });

  const { mutateAsync: loadAssignmentsMutateAsync } = loadAssignmentsMutation;

  const loadAssignments = useCallback(
    async (itemIds: string[]) => {
      if (itemIds.length === 0) return;

      try {
        const assignments = await loadAssignmentsMutateAsync(itemIds);

        setItemAssignments((prev) => {
          const next = new Map(prev);
          for (const id of itemIds) {
            next.set(id, new Set(assignments[id] ?? []));
          }
          return next;
        });
      } catch (err) {
        console.error('Failed to load assignments:', err);
      }
    },
    [loadAssignmentsMutateAsync],
  );

  // -------------------------------------------------------------------------
  // Toggle assignment mutation — with optimistic update + rollback
  // -------------------------------------------------------------------------

  const toggleMutation = useMutation<void, Error, ToggleVariables>({
    mutationFn: async ({ itemId, workspaceId, action }: ToggleVariables) => {
      await mutationFetchJson(`/api/items/${itemId}/workspaces`, {
        workspace_id: workspaceId,
        action,
      });
    },
    onMutate: async ({ itemId, workspaceId, action }: ToggleVariables) => {
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
    },
    onError: (_error, { itemId, workspaceId, action }) => {
      // Rollback optimistic update
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
    },
    onSuccess: (_data, { itemId, workspaceId, workspaceName, action }) => {
      const toastMessage =
        action === 'assign'
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
    },
    onSettled: (_data, _error, { itemId }) => {
      setAssigningItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    },
  });

  // -------------------------------------------------------------------------
  // toggleAssignment wrapper — determines action and calls mutation
  // -------------------------------------------------------------------------

  const { mutateAsync: toggleMutateAsync } = toggleMutation;

  const toggleAssignment = useCallback(
    async (itemId: string, workspaceId: string, workspaceName: string) => {
      const currentAssignments =
        itemAssignments.get(itemId) ?? new Set<string>();
      const isCurrentlyAssigned = currentAssignments.has(workspaceId);
      const action = isCurrentlyAssigned ? 'unassign' : 'assign';

      await toggleMutateAsync({
        itemId,
        workspaceId,
        workspaceName,
        action,
      }).catch(() => {
        // Error already handled in onError callback
      });
    },
    [itemAssignments, toggleMutateAsync],
  );

  const isAssigning = useCallback(
    (itemId: string) => assigningItems.has(itemId),
    [assigningItems],
  );

  return {
    activeWorkspaces: workspacesQuery.data ?? [],
    itemAssignments,
    isLoadingWorkspaces: workspacesQuery.isLoading,
    toggleAssignment,
    isAssigning,
    loadAssignments,
  };
}
