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

export interface WorkspaceOption {
  id: string;
  name: string;
  type: string | null;
}

/**
 * ID-139 {139.9} retired Reclassify/Tag/Assign/Delete — they targeted the
 * deleted `/api/items/*` tree (ID-131 {131.17} removed the `content_items`
 * model) and had no live 1:1 replacement on the current `q_a_pairs` model.
 *
 * ID-135 {135.25} restores Assign-to-workspace and Delete, wiring the
 * {135.22}-shipped `useLibraryBulkActions` handlers (PATCH
 * `/api/q-a-pairs/[id]/workspace` + admin-only DELETE `/api/q-a-pairs/[id]`).
 * Both actions are gated behind a confirm dialog — Assign needs a workspace
 * picked first (a `Dialog`, since it collects input), Delete is a plain
 * yes/no confirm (an `AlertDialog`). Reclassify and Tag stay retired — no
 * valid backing column exists on `q_a_pairs`. Verify (`/api/review/action`)
 * is unaffected by this rebind; Bulk VERIFY currently 404s against
 * `q_a_pairs` (bl-446, open owner question on the audit-trail design) —
 * that is OUT of scope here.
 */
export interface BulkActionToolbarProps {
  selectedCount: number;
  /** Number of selected items that are unverified (verified_at is null) */
  unverifiedSelectedCount?: number;
  bulkOperating: boolean;
  bulkProgress: { current: number; total: number; label: string };
  onBulkVerify: () => void;
  onClearSelection: () => void;

  // Delete (ID-135 {135.25} — admin-only hard DELETE against q_a_pairs)
  onBulkDelete: () => void;

  // Assign to workspace (ID-135 {135.25} — PATCH q_a_pairs.source_workspace_id)
  assignDialogOpen: boolean;
  onAssignDialogOpenChange: (open: boolean) => void;
  workspaces: WorkspaceOption[];
  workspacesLoading: boolean;
  selectedWorkspaceId: string;
  onSelectedWorkspaceIdChange: (id: string) => void;
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
  onBulkDelete,
  assignDialogOpen,
  onAssignDialogOpenChange,
  workspaces,
  workspacesLoading,
  selectedWorkspaceId,
  onSelectedWorkspaceIdChange,
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

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onOpenAssignDialog}
              disabled={bulkOperating}
            >
              <FolderInput className="size-3.5" />
              Assign to workspace
            </Button>

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

      {/* Assign-to-workspace dialog (collects a workspace choice, so a Dialog
          rather than a yes/no AlertDialog) */}
      <Dialog open={assignDialogOpen} onOpenChange={onAssignDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Assign {selectedCount} {selectedCount === 1 ? 'item' : 'items'} to
              a workspace
            </DialogTitle>
            <DialogDescription>
              Choose a workspace for the selected Q&amp;A pairs.
            </DialogDescription>
          </DialogHeader>

          <Select
            value={selectedWorkspaceId || undefined}
            onValueChange={onSelectedWorkspaceIdChange}
            disabled={workspacesLoading}
          >
            <SelectTrigger className="w-full" aria-label="Select workspace">
              <SelectValue
                placeholder={
                  workspacesLoading
                    ? 'Loading workspaces...'
                    : 'Select a workspace'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.name}
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
              disabled={!selectedWorkspaceId || workspacesLoading}
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
