'use client';

import { useState, useRef, useMemo } from 'react';
import {
  Loader2,
  Pencil,
  Merge,
  Trash2,
  Search,
  BarChart3,
  Scissors,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
import { cn } from '@/lib/utils';
import type { TagCount } from '@/hooks/use-tags-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortField = 'count' | 'tag';
type SortOrder = 'asc' | 'desc';

interface TagsBrowseProps {
  tags: TagCount[];
  isAdmin: boolean;
  singletonCount: number;
  renameMutation: {
    mutate: (params: { old: string; new: string; type: string }, opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  mergeMutation: {
    mutate: (params: { source: string; target: string; type: string }, opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  deleteMutation: {
    mutate: (params: { tag: string; type: string }, opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  onDeleteSingletons: () => void;
}

// ---------------------------------------------------------------------------
// Frequency tier helpers
// ---------------------------------------------------------------------------

function getFrequencyTier(
  count: number,
): 'core' | 'common' | 'occasional' | 'rare' {
  if (count >= 10) return 'core';
  if (count >= 4) return 'common';
  if (count >= 2) return 'occasional';
  return 'rare';
}

function getFrequencyClass(tier: string): string {
  switch (tier) {
    case 'core':
      return 'text-tag-core';
    case 'rare':
      return 'text-tag-rare';
    default:
      return 'text-foreground';
  }
}

// ---------------------------------------------------------------------------
// Virtual Tag Row
// ---------------------------------------------------------------------------

function VirtualTagRow({
  tag,
  isAdmin,
  onRename,
  onMerge,
  onDelete,
}: {
  tag: TagCount;
  isAdmin: boolean;
  onRename: (t: TagCount) => void;
  onMerge: (t: TagCount) => void;
  onDelete: (t: TagCount) => void;
}) {
  const tier = getFrequencyTier(tag.count);

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <div className={cn('min-w-0 flex-1', getFrequencyClass(tier))}>
        <span className="text-sm font-medium">{tag.tag}</span>
      </div>
      <Badge variant="outline" className="shrink-0 text-xs">
        {tag.source === 'user' ? 'User' : 'AI'}
      </Badge>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {tag.count} item{tag.count !== 1 ? 's' : ''}
      </span>
      {isAdmin && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            title="Rename tag"
            aria-label={`Rename tag: ${tag.tag}`}
            onClick={() => onRename(tag)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            title="Merge into another tag"
            aria-label={`Merge tag: ${tag.tag}`}
            onClick={() => onMerge(tag)}
          >
            <Merge className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 text-destructive hover:text-destructive"
            title="Delete tag"
            aria-label={`Delete tag: ${tag.tag}`}
            onClick={() => onDelete(tag)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Browse all tags with virtual scrolling, search, sort, and per-tag CRUD.
 * Extracted from tags-section.tsx for the 2-tab redesign.
 */
export function TagsBrowse({
  tags,
  isAdmin,
  singletonCount,
  renameMutation,
  mergeMutation,
  deleteMutation,
  onDeleteSingletons,
}: TagsBrowseProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showSingletons, setShowSingletons] = useState(false);

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

  const parentRef = useRef<HTMLDivElement>(null);

  const actionLoading =
    renameMutation.isPending ||
    mergeMutation.isPending ||
    deleteMutation.isPending;

  // ─── Filtered and sorted tags ───

  const filteredTags = useMemo(() => {
    let result = tags;

    if (!showSingletons) {
      result = result.filter((t) => t.count > 1);
    }

    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((t) => t.tag.toLowerCase().includes(lower));
    }

    result = [...result].sort((a, b) => {
      if (sortField === 'count') {
        return sortOrder === 'desc' ? b.count - a.count : a.count - b.count;
      }
      const cmp = a.tag.localeCompare(b.tag);
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [tags, searchQuery, sortField, sortOrder, showSingletons]);

  const virtualizer = useVirtualizer({
    count: filteredTags.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 15,
  });

  // ─── Tag actions ───

  const handleRename = () => {
    if (!renameDialog.tag || !renameDialog.newName.trim()) return;
    renameMutation.mutate(
      {
        old: renameDialog.tag.tag,
        new: renameDialog.newName.trim(),
        type: renameDialog.tag.source,
      },
      {
        onSuccess: () => {
          setRenameDialog({ open: false, tag: null, newName: '' });
        },
      },
    );
  };

  const handleMerge = () => {
    if (!mergeDialog.tag || !mergeDialog.targetName.trim()) return;
    mergeMutation.mutate(
      {
        source: mergeDialog.tag.tag,
        target: mergeDialog.targetName.trim(),
        type: mergeDialog.tag.source,
      },
      {
        onSuccess: () => {
          setMergeDialog({ open: false, tag: null, targetName: '' });
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteDialog.tag) return;
    deleteMutation.mutate(
      {
        tag: deleteDialog.tag.tag,
        type: deleteDialog.tag.source,
      },
      {
        onSuccess: () => {
          setDeleteDialog({ open: false, tag: null });
        },
      },
    );
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border bg-background pl-9 shadow-sm"
            aria-label="Search tags"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (sortField === 'count') {
              setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
            } else {
              setSortField('count');
              setSortOrder('desc');
            }
          }}
          className={cn(sortField === 'count' && 'border-foreground/30')}
        >
          <BarChart3 className="mr-1.5 size-3.5" />
          Count{' '}
          {sortField === 'count'
            ? sortOrder === 'desc'
              ? '↓'
              : '↑'
            : ''}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (sortField === 'tag') {
              setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
            } else {
              setSortField('tag');
              setSortOrder('asc');
            }
          }}
          className={cn(sortField === 'tag' && 'border-foreground/30')}
        >
          A-Z{' '}
          {sortField === 'tag'
            ? sortOrder === 'asc'
              ? '↑'
              : '↓'
            : ''}
        </Button>
      </div>

      {/* Singleton controls */}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showSingletons}
            onChange={(e) => setShowSingletons(e.target.checked)}
            className="accent-primary"
          />
          Show singletons
          <span className="tabular-nums">({singletonCount})</span>
        </label>
        {isAdmin && singletonCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onDeleteSingletons}
            aria-label={`Delete ${singletonCount} singleton tags`}
          >
            <Trash2 className="mr-1.5 size-3.5" />
            Delete singletons
          </Button>
        )}
        <span className="text-xs text-muted-foreground">
          {filteredTags.length.toLocaleString()} tag
          {filteredTags.length !== 1 ? 's' : ''} shown
        </span>
      </div>

      {/* Virtual scrolled tag list */}
      {filteredTags.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Scissors
            className="size-8 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? 'No tags matching your search.'
              : 'No tags to display. Enable "Show singletons" to see all tags.'}
          </p>
        </div>
      ) : (
        <div
          ref={parentRef}
          className="max-h-[500px] overflow-auto rounded-md border"
          role="list"
          aria-label="Tag list"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const tag = filteredTags[virtualRow.index];
              return (
                <div
                  key={`${tag.source}-${tag.tag}`}
                  role="listitem"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <VirtualTagRow
                    tag={tag}
                    isAdmin={isAdmin}
                    onRename={(t) =>
                      setRenameDialog({
                        open: true,
                        tag: t,
                        newName: t.tag,
                      })
                    }
                    onMerge={(t) =>
                      setMergeDialog({
                        open: true,
                        tag: t,
                        targetName: '',
                      })
                    }
                    onDelete={(t) =>
                      setDeleteDialog({ open: true, tag: t })
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Dialogs ─── */}

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
