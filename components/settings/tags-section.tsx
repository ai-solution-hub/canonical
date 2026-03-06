'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Tags,
  Pencil,
  Merge,
  Trash2,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagCount {
  tag: string;
  count: number;
  source: 'user' | 'ai';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tag management section for the Settings page (Taxonomy tab).
 * Shows all tags with counts, source indicators, and admin actions.
 */
export function TagsSection() {
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog state
  const [renameDialog, setRenameDialog] = useState<{
    open: boolean;
    tag: TagCount | null;
    newName: string;
  }>({ open: false, tag: null, newName: '' });

  const [mergeDialog, setMergeDialog] = useState<{
    open: boolean;
    tag: TagCount | null;
    targetName: string;
  }>({ open: false, tag: null, targetName: '' });

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    tag: TagCount | null;
  }>({ open: false, tag: null });

  // Fetch tags
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags');
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data: TagCount[] = await res.json();
      setTags(data);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
      toast.error('Failed to load tags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Filtered tags
  const filteredTags = searchQuery
    ? tags.filter((t) =>
        t.tag.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : tags;

  // Actions
  const handleRename = async () => {
    if (!renameDialog.tag || !renameDialog.newName.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/tags/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old: renameDialog.tag.tag,
          new: renameDialog.newName.trim(),
          type: renameDialog.tag.source,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rename tag');
      toast.success(
        `Renamed "${renameDialog.tag.tag}" to "${renameDialog.newName.trim()}" (${data.affected} items updated)`,
      );
      setRenameDialog({ open: false, tag: null, newName: '' });
      fetchTags();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to rename tag',
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeDialog.tag || !mergeDialog.targetName.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/tags/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: mergeDialog.tag.tag,
          target: mergeDialog.targetName.trim(),
          type: mergeDialog.tag.source,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to merge tags');
      toast.success(
        `Merged "${mergeDialog.tag.tag}" into "${mergeDialog.targetName.trim()}" (${data.affected} items updated)`,
      );
      setMergeDialog({ open: false, tag: null, targetName: '' });
      fetchTags();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to merge tags',
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.tag) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/tags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: deleteDialog.tag.tag,
          type: deleteDialog.tag.source,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete tag');
      toast.success(
        `Deleted "${deleteDialog.tag.tag}" (${data.affected} items updated)`,
      );
      setDeleteDialog({ open: false, tag: null });
      fetchTags();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete tag',
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Tags className="size-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Tag Management</h2>
          <p className="text-sm text-muted-foreground">
            {tags.length} tags across user tags and AI keywords
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Tag list */}
      {filteredTags.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {searchQuery ? 'No tags matching your search' : 'No tags found'}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border">
          {filteredTags.map((t) => (
            <div
              key={`${t.source}-${t.tag}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">{t.tag}</span>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 text-xs"
              >
                {t.source === 'user' ? 'User' : 'AI'}
              </Badge>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {t.count} item{t.count !== 1 ? 's' : ''}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  title="Rename tag"
                  onClick={() =>
                    setRenameDialog({ open: true, tag: t, newName: t.tag })
                  }
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  title="Merge into another tag"
                  onClick={() =>
                    setMergeDialog({ open: true, tag: t, targetName: '' })
                  }
                >
                  <Merge className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0 text-destructive hover:text-destructive"
                  title="Delete tag"
                  onClick={() =>
                    setDeleteDialog({ open: true, tag: t })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename Dialog */}
      <Dialog
        open={renameDialog.open}
        onOpenChange={(open) => {
          if (!open) setRenameDialog({ open: false, tag: null, newName: '' });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Tag</DialogTitle>
            <DialogDescription>
              Rename &ldquo;{renameDialog.tag?.tag}&rdquo; across all items.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDialog.newName}
            onChange={(e) =>
              setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))
            }
            placeholder="New tag name..."
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setRenameDialog({ open: false, tag: null, newName: '' })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={
                actionLoading ||
                !renameDialog.newName.trim() ||
                renameDialog.newName.trim() === renameDialog.tag?.tag
              }
            >
              {actionLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog */}
      <Dialog
        open={mergeDialog.open}
        onOpenChange={(open) => {
          if (!open) setMergeDialog({ open: false, tag: null, targetName: '' });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Tag</DialogTitle>
            <DialogDescription>
              Merge &ldquo;{mergeDialog.tag?.tag}&rdquo; into another tag. Items
              with the source tag will receive the target tag, then the source
              tag will be removed.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={mergeDialog.targetName}
            onChange={(e) =>
              setMergeDialog((prev) => ({
                ...prev,
                targetName: e.target.value,
              }))
            }
            placeholder="Target tag name..."
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setMergeDialog({ open: false, tag: null, targetName: '' })
              }
            >
              Cancel
            </Button>
            <Button
              onClick={handleMerge}
              disabled={
                actionLoading ||
                !mergeDialog.targetName.trim() ||
                mergeDialog.targetName.trim() === mergeDialog.tag?.tag
              }
            >
              {actionLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => {
          if (!open) setDeleteDialog({ open: false, tag: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tag</DialogTitle>
            <DialogDescription>
              Remove &ldquo;{deleteDialog.tag?.tag}&rdquo; from all{' '}
              {deleteDialog.tag?.count} item
              {deleteDialog.tag?.count !== 1 ? 's' : ''}? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, tag: null })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
