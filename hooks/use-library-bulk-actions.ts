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
import type { EngagementGroupOption } from '@/components/browse/bulk-action-toolbar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseLibraryBulkActionsParams {
  items: ContentListItem[];
  filterDeps: unknown[];
  /** @deprecated No longer needed — bulk actions invalidate queries directly */
  onRefetch?: () => void;
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
 * ID-145 {145.35} (BI-33 owner ruling, S479) — Assign-to-workspace is
 * REMODELLED onto engagement groups: `q_a_pairs.source_workspace_id` was
 * dropped system-wide (W1c, {145.23}), retiring the PATCH
 * `/api/q-a-pairs/[id]/workspace` route (410, permanent). This rebinds onto
 * the new GROUP-SIDE BATCH endpoint, `POST
 * /api/engagement-groups/[id]/content` — ONE request carrying every selected
 * id, replacing the old per-id PATCH loop (the endpoint's write, an
 * idempotent upsert into the additive `engagement_group_content` link
 * table, is naturally all-or-nothing per call, so there is no per-item
 * granularity to loop over server-side). `handleBulkAssignConfirm` therefore
 * calls `runBulkOperation` with a single synthetic unit of work (not one
 * call per selected id) purely to reuse the shared bulkOperating/bulkProgress
 * UI state — the toast copy below reports the REAL selected count, not the
 * runner's 0-or-1 return value.
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

  // Assign-to-engagement-group dialog state + handlers
  assignDialogOpen: boolean;
  setAssignDialogOpen: (open: boolean) => void;
  engagementGroups: EngagementGroupOption[];
  engagementGroupsLoading: boolean;
  selectedEngagementGroupId: string;
  setSelectedEngagementGroupId: (id: string) => void;
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

  // Bulk verify. Success toast only fires when at least one item actually
  // succeeded — previously this fired unconditionally, so a total failure
  // (every operation rejected) produced BOTH the runner's own
  // "N items failed during verifying" error toast AND a nonsensical
  // "Verified 0 items" success toast (the pre-existing double-toast quirk,
  // ID-145 {145.35}).
  const handleBulkVerify = useCallback(async () => {
    const count = await runWithClear('Verifying', async (id) => {
      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: id, action: 'verify' }),
      });
      return res.ok;
    });
    if (count > 0) {
      toast.success(`Verified ${count} item${count !== 1 ? 's' : ''}`);
    }
  }, [runWithClear]);

  // Bulk delete — hard DELETE against q_a_pairs (ID-135 {135.22}); the route
  // itself enforces the admin-only role gate. Same double-toast guard as
  // handleBulkVerify above.
  const handleBulkDelete = useCallback(async () => {
    const count = await runWithClear('Deleting', async (id) => {
      const res = await fetch(`/api/q-a-pairs/${id}`, { method: 'DELETE' });
      return res.ok;
    });
    if (count > 0) {
      toast.success(`Deleted ${count} item${count !== 1 ? 's' : ''}`);
    }
  }, [runWithClear]);

  // Assign-to-engagement-group dialog state (ID-145 {145.35} rebind of the
  // {135.22} S449 addendum)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [engagementGroups, setEngagementGroups] = useState<
    EngagementGroupOption[]
  >([]);
  const [selectedEngagementGroupId, setSelectedEngagementGroupId] =
    useState('');
  const [engagementGroupsLoading, setEngagementGroupsLoading] = useState(false);

  const handleBulkAssignOpen = useCallback(async () => {
    setSelectedEngagementGroupId('');
    setAssignDialogOpen(true);
    setEngagementGroupsLoading(true);

    try {
      const res = await fetch('/api/engagement-groups');
      if (res.ok) {
        const data = await res.json();
        const groups = Array.isArray(data) ? data : [];
        setEngagementGroups(
          groups.map((g: { id: string; name: string }) => ({
            id: g.id,
            name: g.name,
          })),
        );
      }
    } catch {
      toast.error('Failed to load engagement groups');
    } finally {
      setEngagementGroupsLoading(false);
    }
  }, []);

  // Assign to engagement group — ID-145 {145.35}: ONE POST carrying every
  // selected id to the group-side batch endpoint,
  // app/api/engagement-groups/[id]/content/route.ts, which idempotently
  // upserts each into the additive engagement_group_content link table
  // (does NOT touch q_a_pairs.source_form_instance_id — that stays a
  // provenance/lineage field, {145.23}). Replaces the retired per-id PATCH
  // /api/q-a-pairs/[id]/workspace loop.
  const handleBulkAssignConfirm = useCallback(async () => {
    if (!selectedEngagementGroupId) {
      toast.error('Select an engagement group');
      return;
    }
    setAssignDialogOpen(false);

    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      clearSelection();
      return;
    }

    // Single synthetic unit of work: the endpoint takes the WHOLE batch in
    // one call, so this reuses the shared runner's bulkOperating/bulkProgress
    // UI state (rendered as "Assigning 1 of 1...") rather than looping per id
    // — there is no per-item granularity to loop over, since the upsert
    // either links the batch or fails as one unit.
    const count = await runBulkOperation(
      'Assigning',
      [selectedEngagementGroupId],
      async () => {
        const res = await fetch(
          `/api/engagement-groups/${selectedEngagementGroupId}/content`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q_a_pair_ids: ids }),
          },
        );
        return res.ok;
      },
    );
    clearSelection();

    // Guards the same double-toast quirk as handleBulkVerify/handleBulkDelete
    // above — reports the REAL selected count (ids.length), not the runner's
    // 0-or-1 synthetic return value.
    if (count > 0) {
      toast.success(
        `Assigned ${ids.length} item${ids.length !== 1 ? 's' : ''} to an engagement group`,
      );
    }
  }, [
    selectedEngagementGroupId,
    selectedIds,
    runBulkOperation,
    clearSelection,
  ]);

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
    engagementGroups,
    engagementGroupsLoading,
    selectedEngagementGroupId,
    setSelectedEngagementGroupId,
    handleBulkAssignOpen,
    handleBulkAssignConfirm,
  };
}
