'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  FolderInput,
  Loader2,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EngagementGroupOption {
  id: string;
  name: string;
}

/**
 * ID-139 {139.9} retired Reclassify/Tag/Assign/Delete — they targeted the
 * deleted `/api/items/*` tree (ID-131 {131.17} removed the `content_items`
 * model) and had no live 1:1 replacement on the current `q_a_pairs` model.
 *
 * ID-135 {135.25} restored Assign-to-workspace and Delete, wiring the
 * {135.22}-shipped `useLibraryBulkActions` handlers.
 *
 * ID-145 {145.35} (BI-33 owner ruling, S479) — Assign-to-workspace is
 * REMODELLED onto engagement groups: `q_a_pairs.source_workspace_id` was
 * dropped system-wide with no replacement (W1c, {145.23}), retiring
 * `PATCH /api/q-a-pairs/[id]/workspace` (410). The affordance now assigns
 * the selected batch to ONE engagement group via the additive
 * `engagement_group_content` link table
 * (POST `/api/engagement-groups/[id]/content`) — a LINK, never a re-point of
 * provenance. UI copy moves from workspace to engagement vocabulary
 * throughout. Both actions stay gated behind a confirm dialog — Assign
 * needs an engagement group picked first (a `Dialog`, since it collects
 * input), Delete is a plain yes/no confirm (an `AlertDialog`). Reclassify
 * and Tag stay retired — no valid backing column exists on `q_a_pairs`.
 * Verify (`/api/review/action`) is unaffected by this rebind.
 *
 * ID-135 {135.28} — affordance-honesty role gate. Server-side auth was
 * already correct (Assign / engagement-group-content route =
 * ['admin','editor']; hard-DELETE /api/q-a-pairs/[id] = ['admin']); this
 * hides the two buttons client-side so viewers/editors never see an
 * affordance the server will reject. Delete (irreversible hard-delete) is
 * `canAdmin`-only; Assign is `canEdit` (admin or editor). Verify is
 * deliberately NOT gated — out of {135.28}'s scope. Follows the
 * `guide-content.tsx` `{canEdit && (...)}` hide precedent rather than
 * disable-with-tooltip.
 */
export interface BulkActionToolbarProps {
  selectedCount: number;
  /** Number of selected items that are unverified (verified_at is null) */
  unverifiedSelectedCount?: number;
  bulkOperating: boolean;
  bulkProgress: { current: number; total: number; label: string };
  onBulkVerify: () => void;
  onClearSelection: () => void;

  // Role gate (ID-135 {135.28}) — see class doc comment above
  canEdit: boolean;
  canAdmin: boolean;

  // Delete (ID-135 {135.25} — admin-only hard DELETE against q_a_pairs)
  onBulkDelete: () => void;

  // Assign to engagement group (ID-145 {145.35} — POST
  // /api/engagement-groups/[id]/content, replacing the retired PATCH
  // q_a_pairs.source_workspace_id route)
  assignDialogOpen: boolean;
  onAssignDialogOpenChange: (open: boolean) => void;
  engagementGroups: EngagementGroupOption[];
  engagementGroupsLoading: boolean;
  selectedEngagementGroupId: string;
  onSelectedEngagementGroupIdChange: (id: string) => void;
  onOpenAssignDialog: () => void;
  onConfirmAssign: () => void;
}

// ---------------------------------------------------------------------------
// BulkActionToolbar — appears when 1+ items selected
// ---------------------------------------------------------------------------

export function BulkActionToolbar({
  selectedCount,
  unverifiedSelectedCount,
  bulkOperating,
  bulkProgress,
  onBulkVerify,
  onClearSelection,
  canEdit,
  canAdmin,
  onBulkDelete,
  assignDialogOpen,
  onAssignDialogOpenChange,
  engagementGroups,
  engagementGroupsLoading,
  selectedEngagementGroupId,
  onSelectedEngagementGroupIdChange,
  onOpenAssignDialog,
  onConfirmAssign,
}: BulkActionToolbarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (selectedCount === 0) return null;

  const handleDeleteConfirm = () => {
    setDeleteDialogOpen(false);
    onBulkDelete();
  };

  return (
    <>
      <div className="sticky top-0 z-10 mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {selectedCount} selected
          </span>

          {unverifiedSelectedCount != null && unverifiedSelectedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
              <AlertTriangle className="size-3" aria-hidden="true" />
              {unverifiedSelectedCount} of {selectedCount} unverified
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onBulkVerify}
              disabled={bulkOperating}
            >
              <ShieldCheck className="size-3.5" />
              Verify
            </Button>

            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onOpenAssignDialog}
                disabled={bulkOperating}
              >
                <FolderInput className="size-3.5" />
                Assign to engagement group
              </Button>
            )}

            {canAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={bulkOperating}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-xs"
            onClick={onClearSelection}
            disabled={bulkOperating}
          >
            Clear selection
          </Button>
        </div>

        {/* Progress bar */}
        {bulkOperating && (
          <div className="mt-3 space-y-1.5">
            <div
              className="flex items-center gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <Loader2 className="size-3.5 animate-spin" />
              <span>
                {bulkProgress.label} {bulkProgress.current} of{' '}
                {bulkProgress.total}...
              </span>
            </div>
            <Progress
              value={
                bulkProgress.total > 0
                  ? (bulkProgress.current / bulkProgress.total) * 100
                  : 0
              }
              className="h-1.5"
            />
          </div>
        )}
      </div>

      {/* Assign-to-engagement-group dialog (collects a group choice, so a
          Dialog rather than a yes/no AlertDialog) */}
      <Dialog open={assignDialogOpen} onOpenChange={onAssignDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Assign {selectedCount} {selectedCount === 1 ? 'item' : 'items'} to
              an engagement group
            </DialogTitle>
            <DialogDescription>
              Choose an engagement group for the selected library items.
            </DialogDescription>
          </DialogHeader>

          <Select
            value={selectedEngagementGroupId || undefined}
            onValueChange={onSelectedEngagementGroupIdChange}
            disabled={engagementGroupsLoading}
          >
            <SelectTrigger
              className="w-full"
              aria-label="Select engagement group"
            >
              <SelectValue
                placeholder={
                  engagementGroupsLoading
                    ? 'Loading engagement groups...'
                    : 'Select an engagement group'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {engagementGroups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={onConfirmAssign}
              disabled={!selectedEngagementGroupId || engagementGroupsLoading}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} {selectedCount === 1 ? 'item' : 'items'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected Q&amp;A pairs. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
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
