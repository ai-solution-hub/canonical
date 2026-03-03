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
import { ProjectColourPicker } from '@/components/project-colour-picker';
import { ProjectIconPicker } from '@/components/project-icon-picker';
import { formatDate, formatContentType } from '@/lib/format';
import type { ProjectWithCounts } from '@/components/project-card';

interface ProjectItem {
  id: string;
  suggested_title: string | null;
  content_type: string | null;
  captured_date: string | null;
  assigned_at: string;
}

interface ProjectDetailSheetProps {
  project: ProjectWithCounts | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (project: ProjectWithCounts) => void;
  onArchiveToggle: (project: ProjectWithCounts) => void;
  onDeleted: (projectId: string) => void;
}

export function ProjectDetailSheet({
  project,
  open,
  onOpenChange,
  onUpdated,
  onArchiveToggle,
  onDeleted,
}: ProjectDetailSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [icon, setIcon] = useState('folder');
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nameRef = useRef(name);
  const descRef = useRef(description);
  nameRef.current = name;
  descRef.current = description;

  // Sync local state when project changes
  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description ?? '');
      setColor(project.color);
      setIcon(project.icon);
    }
  }, [project]);

  // Fetch recent items when sheet opens
  useEffect(() => {
    if (!open || !project) return;
    setLoadingItems(true);
    fetch(`/api/projects/${project.id}/items?limit=10`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));
  }, [open, project]);

  const patchProject = useCallback(
    async (updates: Record<string, unknown>) => {
      if (!project) return;
      try {
        const res = await fetch(`/api/projects/${project.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (res.status === 409) {
          toast.error('A project with that name already exists');
          // Revert name
          setName(project.name);
          return;
        }
        if (!res.ok) throw new Error();
        const updated = await res.json();
        toast('Project updated', { duration: 1500 });
        onUpdated({
          ...project,
          ...updated,
          item_count: project.item_count,
          last_activity: project.last_activity,
        });
      } catch {
        toast.error('Failed to update project');
      }
    },
    [project, onUpdated],
  );

  const handleNameBlur = useCallback(() => {
    const trimmed = nameRef.current.trim();
    if (!trimmed) {
      toast.error('Project name cannot be empty');
      if (project) setName(project.name);
      return;
    }
    if (project && trimmed !== project.name) {
      patchProject({ name: trimmed });
    }
  }, [project, patchProject]);

  const handleDescriptionBlur = useCallback(() => {
    const trimmed = descRef.current.trim();
    const prev = project?.description?.trim() ?? '';
    if (trimmed !== prev) {
      patchProject({ description: trimmed || null });
    }
  }, [project, patchProject]);

  const handleColourChange = useCallback(
    (hex: string) => {
      setColor(hex);
      patchProject({ color: hex });
    },
    [patchProject],
  );

  const handleIconChange = useCallback(
    (newIcon: string) => {
      setIcon(newIcon);
      patchProject({ icon: newIcon });
    },
    [patchProject],
  );

  const handleArchive = useCallback(() => {
    if (!project) return;
    onArchiveToggle(project);
    onOpenChange(false);
  }, [project, onArchiveToggle, onOpenChange]);

  const handleDelete = useCallback(async () => {
    if (!project) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/projects/${project.id}?permanent=true`,
        { method: 'DELETE' },
      );
      if (res.status === 409) {
        toast.error(
          'Cannot delete a project with assigned items. Remove all items first.',
        );
        return;
      }
      if (!res.ok) throw new Error();
      toast(`Deleted "${project.name}"`, { duration: 2000 });
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onDeleted(project.id);
    } catch {
      toast.error('Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }, [project, onOpenChange, onDeleted]);

  if (!project) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle>Edit Project</SheetTitle>
            <SheetDescription>
              Update project details or manage items.
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
              />
            </div>

            {/* Colour */}
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <ProjectColourPicker
                value={color}
                onChange={handleColourChange}
              />
            </div>

            {/* Icon */}
            <div className="space-y-1.5">
              <Label>Icon</Label>
              <ProjectIconPicker value={icon} onChange={handleIconChange} />
            </div>

            <Separator />

            {/* Recent items */}
            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Recent Items
                {project.item_count > 0 && (
                  <span className="ml-1 text-muted-foreground">
                    ({items.length} of {project.item_count})
                  </span>
                )}
              </h3>

              {loadingItems ? (
                <p className="text-xs text-muted-foreground">Loading...</p>
              ) : items.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No content items assigned to this project yet.
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

              {project.item_count > 0 && (
                <Link
                  href={`/browse?project=${project.id}`}
                  onClick={() => onOpenChange(false)}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View all {project.item_count} items in Browse
                  <ExternalLink className="size-3" />
                </Link>
              )}
            </div>

            <Separator />

            {/* Metadata */}
            <p className="text-xs text-muted-foreground">
              Created: {formatDate(project.created_at)}
            </p>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={handleArchive}
              >
                {project.is_archived
                  ? 'Unarchive Project'
                  : 'Archive Project'}
              </Button>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={project.item_count > 0}
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        Delete Project
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {project.item_count > 0 && (
                    <TooltipContent>
                      Remove all items from this project before deleting.
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </div>
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
              Delete &ldquo;{project.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The project will be permanently
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
