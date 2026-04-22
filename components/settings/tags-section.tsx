'use client';

import { useState, useMemo, useCallback } from 'react';
import { Loader2, Tags, Info } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useUserRole } from '@/hooks/use-user-role';
import { useTagsData } from '@/hooks/use-tags-data';
import { mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import { TagsCleanup } from './tags-cleanup';
import { TagsBrowse } from './tags-browse';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tag management section for the Settings page (Taxonomy tab).
 * Two-tab layout: "Clean up" (duplicates + domain view + bulk actions)
 * and "Browse all" (virtual-scrolled tag list with per-tag CRUD).
 */
export function TagsSection() {
  const { canAdmin, loading: roleLoading } = useUserRole();

  const {
    tags,
    duplicates,
    domainGroups,
    loading,
    renameMutation,
    mergeMutation,
    deleteMutation,
    invalidateAllTags,
  } = useTagsData();

  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const [singletonDeleteDialog, setSingletonDeleteDialog] = useState(false);
  const [deletingSingletons, setDeletingSingletons] = useState(false);

  // Default tab: Clean up when duplicates exist, Browse all otherwise
  const effectiveTab =
    activeTab ?? (duplicates.length > 0 ? 'cleanup' : 'browse');

  // ─── Summary stats ───

  const stats = useMemo(() => {
    const singletons = tags.filter((t) => t.count === 1).length;
    const domainCount = domainGroups.length;
    return { total: tags.length, singletons, domainCount };
  }, [tags, domainGroups]);

  // ─── Singleton bulk-delete handler ───

  const handleDeleteSingletons = useCallback(async () => {
    setDeletingSingletons(true);
    setSingletonDeleteDialog(false);

    const singletonTags = tags.filter((t) => t.count === 1);
    const aiSingletons = singletonTags.filter((t) => t.source === 'ai').map((t) => t.tag);
    const userSingletons = singletonTags.filter((t) => t.source === 'user').map((t) => t.tag);

    const errors: string[] = [];
    let totalAffected = 0;

    for (const [tagNames, type] of [
      [aiSingletons, 'ai'],
      [userSingletons, 'user'],
    ] as const) {
      if (tagNames.length === 0) continue;
      try {
        const data = await mutationFetchJson<{ affected?: number }>(
          '/api/tags/bulk-delete',
          { tags: tagNames, type },
        );
        totalAffected += data.affected ?? 0;
      } catch (err) {
        errors.push(
          `${type} tags: ${err instanceof Error ? err.message : 'Failed'}`,
        );
      }
    }

    setDeletingSingletons(false);

    if (errors.length > 0) {
      toast.error(`Some deletions failed: ${errors.join(', ')}`);
    } else {
      toast.success(
        `Deleted ${stats.singletons} singleton tag${stats.singletons !== 1 ? 's' : ''} (${totalAffected} items updated)`,
      );
    }

    invalidateAllTags();
  }, [tags, stats.singletons, invalidateAllTags]);

  // ─── Render ───

  if (loading || roleLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header with inline summary ─── */}
      <div>
        <div className="flex items-center gap-3">
          <Tags className="size-5 text-muted-foreground" aria-hidden="true" />
          <h3 className="flex items-center gap-1.5 text-lg font-semibold">
            Tag Health
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground"
                    aria-label="More information about tags"
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Tags are generated automatically when content is ingested.
                  Use Clean up to merge duplicates and tidy domain-grouped
                  tags. Browse all shows the full tag list with search and
                  sort.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {stats.total.toLocaleString()} tags across{' '}
          {stats.domainCount} domain{stats.domainCount !== 1 ? 's' : ''}
          {duplicates.length > 0 && (
            <>
              {' '}
              &middot;{' '}
              <span className="text-freshness-aging">
                {duplicates.length} duplicate group{duplicates.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </p>
      </div>

      {/* ─── Two-tab layout ─── */}
      <Tabs value={effectiveTab} onValueChange={setActiveTab}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="cleanup">
            Clean up
            {duplicates.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1.5 size-5 items-center justify-center rounded-full p-0 text-[10px]"
              >
                {duplicates.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="browse">Browse all</TabsTrigger>
        </TabsList>

        <TabsContent value="cleanup">
          <TagsCleanup
            duplicates={duplicates}
            domainGroups={domainGroups}
            tags={tags}
            isAdmin={canAdmin}
            onActionComplete={invalidateAllTags}
          />
        </TabsContent>

        <TabsContent value="browse">
          <TagsBrowse
            tags={tags}
            isAdmin={canAdmin}
            singletonCount={stats.singletons}
            renameMutation={renameMutation}
            mergeMutation={mergeMutation}
            deleteMutation={deleteMutation}
            onDeleteSingletons={() => setSingletonDeleteDialog(true)}
          />
        </TabsContent>
      </Tabs>

      {/* ─── Singleton delete confirmation ─── */}
      <Dialog
        open={singletonDeleteDialog}
        onOpenChange={setSingletonDeleteDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Singleton Tags</DialogTitle>
            <DialogDescription>
              This will remove {stats.singletons} tag
              {stats.singletons !== 1 ? 's' : ''} that appear on only one item
              each. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSingletonDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSingletons}
              disabled={deletingSingletons}
            >
              {deletingSingletons ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Delete {stats.singletons} singleton{stats.singletons !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
