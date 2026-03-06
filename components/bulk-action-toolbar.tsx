'use client';

import {
  Loader2,
  Tag,
  FolderPlus,
  ShieldCheck,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BulkActionToolbarProps {
  selectedCount: number;
  isAdmin: boolean;
  bulkOperating: boolean;
  bulkProgress: { current: number; total: number; label: string };
  onBulkReclassify: () => void;
  onBulkTag: () => void;
  onBulkAssign: () => void;
  onBulkVerify: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

// ---------------------------------------------------------------------------
// BulkActionToolbar — appears when 1+ items selected
// ---------------------------------------------------------------------------

export function BulkActionToolbar({
  selectedCount,
  isAdmin,
  bulkOperating,
  bulkProgress,
  onBulkReclassify,
  onBulkTag,
  onBulkAssign,
  onBulkVerify,
  onBulkDelete,
  onClearSelection,
}: BulkActionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkReclassify}
            disabled={bulkOperating}
          >
            <RefreshCw className="size-3.5" />
            Re-classify
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkTag}
            disabled={bulkOperating}
          >
            <Tag className="size-3.5" />
            Tag
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkAssign}
            disabled={bulkOperating}
          >
            <FolderPlus className="size-3.5" />
            Assign to workspace
          </Button>

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

          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                  disabled={bulkOperating}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selectedCount} Q&A pair{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. The selected Q&A pairs will be
                    permanently removed from the library.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onBulkDelete}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete {selectedCount} item{selectedCount !== 1 ? 's' : ''}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            <span>
              {bulkProgress.label} {bulkProgress.current}/{bulkProgress.total}...
            </span>
          </div>
          <Progress
            value={bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}
            className="h-1.5"
          />
        </div>
      )}
    </div>
  );
}
