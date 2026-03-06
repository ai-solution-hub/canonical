'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { WorkspaceColourPicker } from '@/components/workspace-colour-picker';
import { WorkspaceIconPicker } from '@/components/workspace-icon-picker';
import { formatDate, formatContentType } from '@/lib/format';
import type { WorkspaceWithCounts } from '@/components/workspace-card';

interface WorkspaceItem {
  id: string;
  suggested_title: string | null;
  content_type: string | null;
  captured_date: string | null;
  assigned_at: string;
}

interface WorkspaceDetailSheetProps {
  workspace: WorkspaceWithCounts | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (workspace: WorkspaceWithCounts) => void;
  onArchiveToggle: (workspace: WorkspaceWithCounts) => void;
  onDeleted: (workspaceId: string) => void;
  readOnly?: boolean;
  isAdmin?: boolean;
}

export function WorkspaceDetailSheet({
  workspace,
  open,
  onOpenChange,
  onUpdated,
  onArchiveToggle,
  onDeleted,
  readOnly = false,
  isAdmin = false,
}: WorkspaceDetailSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [icon, setIcon] = useState('folder');
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nameRef = useRef(name);
  const descRef = useRef(description);
  nameRef.current = name;
  descRef.current = description;

  // Sync local state when workspace changes
  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setDescription(workspace.description ?? '');
      setColor(workspace.color);
      setIcon(workspace.icon);
    }
  }, [workspace]);

  // Fetch recent items when sheet opens
  useEffect(() => {
    if (!open || !workspace) return;
    setLoadingItems(true);
    fetch(`/api/workspaces/${workspace.id}/items?limit=10`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));
  }, [open, workspace]);

  const patchWorkspace = useCallback(
    async (updates: Record<string, unknown>) => {
      if (!workspace) return;
      try {
        const res = await fetch(`/api/workspaces/${workspace.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.status === 409) {
          toast.error('A workspace with that name already exists');
          // Revert name
          setName(workspace.name);
          return;
        }
        if (!res.ok) throw new Error();
        const updated = await res.json();
        toast('Workspace updated', { duration: 1500 });
        onUpdated({
          ...workspace,
          ...updated,
          item_count: workspace.item_count,
          last_activity: workspace.last_activity,
        });
      } catch {
        toast.error('Failed to update workspace');
      }
    },
    [workspace, onUpdated],
  );

  const handleNameBlur = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) {
      toast.error('Workspace name cannot be empty');
      if (workspace) setName(workspace.name);
      return;
    }
    if (workspace && trimmed !== workspace.name) {
      patchWorkspace({ name: trimmed });
    }
  }, [workspace, patchWorkspace]);

  const handleDescriptionBlur = useCallback(() => {
    const trimmed = descRef.current.trim();
    const prev = workspace?.description?.trim() ?? '';
    if (trimmed !== prev) {
      patchWorkspace({ description: trimmed || null });
    }
  }, [workspace, patchWorkspace]);

  const handleColourChange = useCallback(
    (hex: string) => {
      setColor(hex);
      patchWorkspace({ color: hex });
    },
    [patchWorkspace],
  );

  const handleIconChange = useCallback(
    (newIcon: string) => {
      setIcon(newIcon);
      patchWorkspace({ icon: newIcon });
    },
    [patchWorkspace],
  );

  const handleArchive = useCallback(() => {
    if (!workspace) return;
    onArchiveToggle(workspace);
    onOpenChange(false);
  }, [workspace, onArchiveToggle, onOpenChange]);

  const handleDelete = useCallback(async () => {
    if (!workspace) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/workspaces/${workspace.id}?permanent=true`,
        { method: 'DELETE' },
      );
      if (res.status === 409) {
        toast.error(
          'Cannot delete a workspace with assigned items. Remove all items first.',
        );
        return;
      }
      if (!res.ok) throw new Error();
      toast(`Deleted "${workspace.name}"`, { duration: 2000 });
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onDeleted(workspace.id);
    } catch {
      toast.error('Failed to delete workspace');
    } finally {
      setDeleting(false);
    }
  }, [workspace, onOpenChange, onDeleted]);

  if (!workspace) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>Edit Workspace</SheetTitle>
            <SheetDescription>
              Update workspace details or manage items.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-5 px-4 pb-6">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                maxLength={200}
                readOnly={readOnly}
                className={readOnly ? 'cursor-default opacity-70' : ''}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-desc">Description</Label>
              <Textarea
                id="edit-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                rows={3}
                maxLength={2000}
                placeholder="Optional description"
                readOnly={readOnly}
                className={readOnly ? 'cursor-default opacity-70' : ''}
              />
            </div>

            {/* Colour — hide for read-only */}
            {!readOnly && (
              <div className="space-y-1.5">
                <Label>Colour</Label>
                <WorkspaceColourPicker
                  value={color}
                  onChange={handleColourChange}
                />
              </div>
            )}

            {/* Icon — hide for read-only */}
            {!readOnly && (
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <WorkspaceIconPicker value={icon} onChange={handleIconChange} />
              </div>
            )}

            <Separator />

            {/* Recent items */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Recent Items
                {workspace.item_count > 0 && (
                  <span className="ml-1 text-muted-foreground">
                    ({items.length} of {workspace.item_count})
                  </span>
                )}
              </h3>

              {loadingItems ? (
                <p className="text-xs text-muted-foreground">Loading...</p>
              ) : items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No content items assigned to this workspace yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/item/${item.id}`}
                        onClick={() => onOpenChange(false)}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.suggested_title || 'Untitled'}
                        </span>
                        {item.content_type && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-[10px]"
                          >
                            {formatContentType(item.content_type)}
                          </Badge>
                        )}
                        <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {workspace.item_count > 0 && (
                <Link
                  href={`/browse?workspace=${workspace.id}`}
                  onClick={() => onOpenChange(false)}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View all {workspace.item_count} items in Browse
                  <ExternalLink className="size-3" />
                </Link>
              )}
            </div>

            <Separator />

            {/* Metadata */}
            <p className="text-xs text-muted-foreground">
              Created: {formatDate(workspace.created_at)}
            </p>

            {/* Actions — hidden for read-only users */}
            {!readOnly && (
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleArchive}
                >
                  {workspace.is_archived
                    ? 'Unarchive Workspace'
                    : 'Archive Workspace'}
                </Button>

                {isAdmin && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={workspace.item_count > 0}
                            onClick={() => setShowDeleteConfirm(true)}
                          >
                            Delete Workspace
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {workspace.item_count > 0 && (
                        <TooltipContent>
                          Remove all items from this workspace before deleting.
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{workspace.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The workspace will be permanently
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
