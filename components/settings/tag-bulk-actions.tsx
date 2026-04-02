'use client';

import { useState, useMemo } from 'react';
import {
  Loader2,
  Trash2,
  Merge,
  Search,
  CheckSquare,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagCount {
  tag: string;
  count: number;
  source: 'user' | 'ai';
}

interface TagBulkActionsProps {
  tags: TagCount[];
  isAdmin: boolean;
  onActionComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-select toolbar for bulk tag delete/merge operations.
 * Allows selecting multiple tags, then applying bulk delete or merge.
 */
export function TagBulkActions({
  tags,
  isAdmin,
  onActionComplete,
}: TagBulkActionsProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [mergeDialog, setMergeDialog] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  // Filter tags by search
  const filteredTags = useMemo(() => {
    if (!searchQuery) return tags;
    const lower = searchQuery.toLowerCase();
    return tags.filter((t) => t.tag.toLowerCase().includes(lower));
  }, [tags, searchQuery]);

  // Separate by source for grouped display
  const aiTags = useMemo(
    () => filteredTags.filter((t) => t.source === 'ai'),
    [filteredTags],
  );
  const userTags = useMemo(
    () => filteredTags.filter((t) => t.source === 'user'),
    [filteredTags],
  );

  const toggleTag = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filteredTags.map((t) => `${t.source}:${t.tag}`)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  // Parse selected into source-grouped sets
  const selectedBySource = useMemo(() => {
    const ai: string[] = [];
    const user: string[] = [];
    for (const key of selected) {
      const [source, ...tagParts] = key.split(':');
      const tag = tagParts.join(':');
      if (source === 'ai') ai.push(tag);
      else user.push(tag);
    }
    return { ai, user };
  }, [selected]);

  const handleBulkDelete = async () => {
    if (!isAdmin) return;
    setDeleteDialog(false);
    setActionLoading(true);

    let totalAffected = 0;
    const errors: string[] = [];

    // Delete AI tags
    if (selectedBySource.ai.length > 0) {
      try {
        const res = await fetch('/api/tags/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: selectedBySource.ai, type: 'ai' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        totalAffected += data.affected ?? 0;
      } catch (err) {
        errors.push(
          `AI tags: ${err instanceof Error ? err.message : 'Failed'}`,
        );
      }
    }

    // Delete user tags
    if (selectedBySource.user.length > 0) {
      try {
        const res = await fetch('/api/tags/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: selectedBySource.user, type: 'user' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        totalAffected += data.affected ?? 0;
      } catch (err) {
        errors.push(
          `User tags: ${err instanceof Error ? err.message : 'Failed'}`,
        );
      }
    }

    setActionLoading(false);

    if (errors.length > 0) {
      toast.error(`Some deletions failed: ${errors.join(', ')}`);
    } else {
      toast.success(
        `Deleted ${selected.size} tag${selected.size !== 1 ? 's' : ''} (${totalAffected} items updated)`,
      );
    }

    setSelected(new Set());
    onActionComplete();
  };

  const handleBulkMerge = async () => {
    if (!isAdmin || !mergeTarget.trim()) return;
    setMergeDialog(false);
    setActionLoading(true);

    const target = mergeTarget.trim();
    let totalAffected = 0;
    const errors: string[] = [];

    // Merge AI tags
    const aiSources = selectedBySource.ai.filter((t) => t !== target);
    if (aiSources.length > 0) {
      try {
        const res = await fetch('/api/tags/bulk-merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources: aiSources,
            target,
            type: 'ai',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        totalAffected += data.affected ?? 0;
      } catch (err) {
        errors.push(
          `AI tags: ${err instanceof Error ? err.message : 'Failed'}`,
        );
      }
    }

    // Merge user tags
    const userSources = selectedBySource.user.filter((t) => t !== target);
    if (userSources.length > 0) {
      try {
        const res = await fetch('/api/tags/bulk-merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources: userSources,
            target,
            type: 'user',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        totalAffected += data.affected ?? 0;
      } catch (err) {
        errors.push(
          `User tags: ${err instanceof Error ? err.message : 'Failed'}`,
        );
      }
    }

    setActionLoading(false);

    if (errors.length > 0) {
      toast.error(`Some merges failed: ${errors.join(', ')}`);
    } else {
      toast.success(
        `Merged ${selected.size} tag${selected.size !== 1 ? 's' : ''} into "${target}" (${totalAffected} items updated)`,
      );
    }

    setSelected(new Set());
    setMergeTarget('');
    onActionComplete();
  };

  const renderTagList = (tagList: TagCount[], label: string) => {
    if (tagList.length === 0) return null;

    return (
      <div className="space-y-1">
        <h4 className="px-4 text-xs font-medium text-muted-foreground">
          {label} ({tagList.length})
        </h4>
        <div className="divide-y divide-border">
          {tagList.map((t) => {
            const key = `${t.source}:${t.tag}`;
            const isSelected = selected.has(key);

            return (
              <label
                key={key}
                className={cn(
                  'flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/50',
                  isSelected && 'bg-muted/30',
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleTag(key)}
                  aria-label={`Select ${t.tag}`}
                />
                <span className="min-w-0 flex-1 text-sm">{t.tag}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t.count} item{t.count !== 1 ? 's' : ''}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Filter tags for bulk actions"
          />
        </div>

        {/* Select/deselect */}
        <Button variant="outline" size="sm" onClick={selectAllVisible}>
          <CheckSquare className="mr-1.5 size-3.5" />
          Select all
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={deselectAll}
          disabled={selected.size === 0}
        >
          <Square className="mr-1.5 size-3.5" />
          Deselect
        </Button>
      </div>

      {/* Selection summary and actions */}
      {selected.size > 0 && isAdmin && (
        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-2">
          <Badge variant="secondary">{selected.size} selected</Badge>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Pre-fill merge target with the first selected tag
                const firstKey = [...selected][0];
                const tag = firstKey.split(':').slice(1).join(':');
                setMergeTarget(tag);
                setMergeDialog(true);
              }}
              disabled={actionLoading || selected.size < 2}
            >
              <Merge className="mr-1.5 size-3.5" />
              Merge selected
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialog(true)}
              disabled={actionLoading}
            >
              <Trash2 className="mr-1.5 size-3.5" />
              Delete selected
            </Button>
          </div>
        </div>
      )}

      {!isAdmin && (
        <p className="text-sm text-muted-foreground">
          Admin role required for bulk operations.
        </p>
      )}

      {/* Tag lists grouped by source */}
      <div className="space-y-4 rounded-md border">
        {renderTagList(aiTags, 'AI Keywords')}
        {renderTagList(userTags, 'User Tags')}
        {filteredTags.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {searchQuery
              ? 'No tags matching your filter.'
              : 'No tags available.'}
          </div>
        )}
      </div>

      {/* Loading overlay */}
      {actionLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Processing...
          </span>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Selected Tags</DialogTitle>
            <DialogDescription>
              This will remove {selected.size} tag
              {selected.size !== 1 ? 's' : ''} from all content items. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete}>
              Delete {selected.size} tag{selected.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation Dialog */}
      <Dialog open={mergeDialog} onOpenChange={setMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Selected Tags</DialogTitle>
            <DialogDescription>
              Merge {selected.size} selected tag{selected.size !== 1 ? 's' : ''}{' '}
              into a single target tag. All variants will be replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="merge-target" className="text-sm font-medium">
              Target tag name
            </label>
            <Input
              id="merge-target"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              placeholder="Enter the canonical tag name..."
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkMerge} disabled={!mergeTarget.trim()}>
              Merge into &ldquo;{mergeTarget.trim()}&rdquo;
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
