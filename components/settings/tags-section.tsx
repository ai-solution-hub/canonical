'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Loader2,
  Tags,
  Pencil,
  Merge,
  Trash2,
  Search,
  AlertTriangle,
  Scissors,
  BarChart3,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';
import { DuplicateReview } from './duplicate-review';
import type { DuplicateGroup } from './duplicate-review';
import { TagDomainView } from './tag-domain-view';
import type { DomainTagGroup } from './tag-domain-view';
import { TagBulkActions } from './tag-bulk-actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagCount {
  tag: string;
  count: number;
  source: 'user' | 'ai';
}

type SortField = 'count' | 'tag';
type SortOrder = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Frequency tier helpers
// ---------------------------------------------------------------------------

function getFrequencyTier(count: number): 'core' | 'common' | 'occasional' | 'rare' {
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
 * Tag management section for the Settings page (Taxonomy tab).
 * Redesigned with summary dashboard, tabbed view (Duplicates, By Domain,
 * All Tags, Bulk Actions), virtual scrolling, and frequency tiers.
 */
export function TagsSection() {
  const { canAdmin, loading: roleLoading } = useUserRole();

  // Data state
  const [tags, setTags] = useState<TagCount[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [domainGroups, setDomainGroups] = useState<DomainTagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  // All Tags tab state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showSingletons, setShowSingletons] = useState(false);
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

  // Virtual scroll ref
  const parentRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────
  // Data fetching
  // ─────────────────────────────────────────

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch('/api/tags');
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data: TagCount[] = await res.json();
      setTags(data);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
      toast.error('Failed to load tags');
    }
  }, []);

  const fetchDuplicates = useCallback(async () => {
    try {
      const res = await fetch('/api/tags/duplicates?type=ai');
      if (!res.ok) throw new Error('Failed to fetch duplicates');
      const data: DuplicateGroup[] = await res.json();
      setDuplicates(data);
    } catch (err) {
      console.error('Failed to fetch duplicates:', err);
    }
  }, []);

  const fetchDomainGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/tags/by-domain?type=ai');
      if (!res.ok) throw new Error('Failed to fetch domain groups');
      const data: DomainTagGroup[] = await res.json();
      setDomainGroups(data);
    } catch (err) {
      console.error('Failed to fetch domain groups:', err);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchTags(), fetchDuplicates(), fetchDomainGroups()]);
    setLoading(false);
  }, [fetchTags, fetchDuplicates, fetchDomainGroups]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Set default active tab based on data
  useEffect(() => {
    if (!loading && activeTab === undefined) {
      setActiveTab(duplicates.length > 0 ? 'duplicates' : 'all');
    }
  }, [loading, duplicates.length, activeTab]);

  // ─────────────────────────────────────────
  // Summary stats
  // ─────────────────────────────────────────

  const stats = useMemo(() => {
    const singletons = tags.filter((t) => t.count === 1).length;
    return {
      total: tags.length,
      duplicateGroups: duplicates.length,
      singletons,
    };
  }, [tags, duplicates]);

  // ─────────────────────────────────────────
  // Filtered and sorted tags for All Tags tab
  // ─────────────────────────────────────────

  const filteredTags = useMemo(() => {
    let result = tags;

    // Hide singletons by default
    if (!showSingletons) {
      result = result.filter((t) => t.count > 1);
    }

    // Search filter
    if (searchQuery) {
      const lower = searchQuery.toLowerCase();
      result = result.filter((t) => t.tag.toLowerCase().includes(lower));
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortField === 'count') {
        return sortOrder === 'desc' ? b.count - a.count : a.count - b.count;
      }
      const cmp = a.tag.localeCompare(b.tag);
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [tags, searchQuery, sortField, sortOrder, showSingletons]);

  // Virtual scrolling
  const virtualizer = useVirtualizer({
    count: filteredTags.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44, // ~44px per row
    overscan: 15,
  });

  // ─────────────────────────────────────────
  // Tag actions
  // ─────────────────────────────────────────

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
      fetchAll();
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
      fetchAll();
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
      fetchAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete tag',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // ─────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────

  if (loading || roleLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Summary Header ─── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Tags className="size-5 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Tag Health</h3>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Total tags */}
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">Total tags</div>
          </div>

          {/* Duplicate groups */}
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {stats.duplicateGroups}
              </span>
              {stats.duplicateGroups > 0 && (
                <AlertTriangle
                  className="size-4 text-freshness-aging"
                  aria-label="Duplicates need attention"
                />
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Duplicate groups
            </div>
          </div>

          {/* Singletons */}
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums text-tag-rare">
              {stats.singletons.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              Singleton tags (hidden by default)
            </div>
          </div>
        </div>
      </div>

      {/* ─── Tabbed View ─── */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="duplicates">
            Duplicates
            {stats.duplicateGroups > 0 && (
              <Badge
                variant="secondary"
                className="ml-1.5 size-5 items-center justify-center rounded-full p-0 text-[10px]"
              >
                {stats.duplicateGroups}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="domains">By Domain</TabsTrigger>
          <TabsTrigger value="all">All Tags</TabsTrigger>
          {canAdmin && (
            <TabsTrigger value="bulk">Bulk Actions</TabsTrigger>
          )}
        </TabsList>

        {/* ─── Duplicates Tab ─── */}
        <TabsContent value="duplicates">
          <DuplicateReview
            duplicates={duplicates}
            isAdmin={canAdmin}
            onMergeComplete={fetchAll}
          />
        </TabsContent>

        {/* ─── By Domain Tab ─── */}
        <TabsContent value="domains">
          <TagDomainView groups={domainGroups} />
        </TabsContent>

        {/* ─── All Tags Tab ─── */}
        <TabsContent value="all">
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
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
                Count {sortField === 'count' ? (sortOrder === 'desc' ? '\u2193' : '\u2191') : ''}
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
                A-Z {sortField === 'tag' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : ''}
              </Button>
            </div>

            {/* Singleton toggle */}
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showSingletons}
                  onChange={(e) => setShowSingletons(e.target.checked)}
                  className="accent-primary"
                />
                Show singletons
                <span className="tabular-nums">({stats.singletons})</span>
              </label>
              <span className="text-xs text-muted-foreground">
                {filteredTags.length.toLocaleString()} tag{filteredTags.length !== 1 ? 's' : ''} shown
              </span>
            </div>

            {/* Virtual scrolled tag list */}
            {filteredTags.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Scissors className="size-8 text-muted-foreground/50" aria-hidden="true" />
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
                          isAdmin={canAdmin}
                          onRename={(t) =>
                            setRenameDialog({ open: true, tag: t, newName: t.tag })
                          }
                          onMerge={(t) =>
                            setMergeDialog({ open: true, tag: t, targetName: '' })
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
          </div>
        </TabsContent>

        {/* ─── Bulk Actions Tab ─── */}
        {canAdmin && (
          <TabsContent value="bulk">
            <TagBulkActions
              tags={tags}
              isAdmin={canAdmin}
              onActionComplete={fetchAll}
            />
          </TabsContent>
        )}
      </Tabs>

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
