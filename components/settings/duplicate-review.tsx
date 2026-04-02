'use client';

import { useState } from 'react';
import { Loader2, Merge, Check, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

export interface DuplicateGroup {
  canonical: string;
  variants: string[];
  variant_count: number;
  total_usage: number;
}

interface DuplicateReviewProps {
  duplicates: DuplicateGroup[];
  isAdmin: boolean;
  onMergeComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Guided merge flow for duplicate tag groups.
 * Shows each group with variants and usage counts, suggests a canonical form,
 * and allows one-click merge per group or merge all.
 */
export function DuplicateReview({
  duplicates,
  isAdmin,
  onMergeComplete,
}: DuplicateReviewProps) {
  const [merging, setMerging] = useState<string | null>(null);
  const [mergingAll, setMergingAll] = useState(false);
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set());
  const [editingCanonical, setEditingCanonical] = useState<
    Record<string, string>
  >({});
  const [confirmMergeAll, setConfirmMergeAll] = useState(false);

  const remainingGroups = duplicates.filter(
    (g) => !mergedGroups.has(g.canonical),
  );

  const getCanonical = (group: DuplicateGroup) =>
    editingCanonical[group.canonical] ?? group.canonical;

  const handleMergeGroup = async (group: DuplicateGroup) => {
    if (!isAdmin) return;
    const canonical = getCanonical(group);
    const sources = group.variants.filter((v) => v !== canonical);

    if (sources.length === 0) {
      toast.error('No variants to merge — canonical form matches all variants');
      return;
    }

    setMerging(group.canonical);
    try {
      const res = await fetch('/api/tags/bulk-merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          target: canonical,
          type: 'ai',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to merge group');

      setMergedGroups((prev) => new Set([...prev, group.canonical]));
      toast.success(
        `Merged ${sources.length} variant${sources.length !== 1 ? 's' : ''} into "${canonical}" (${data.affected} items updated)`,
      );
      onMergeComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge group');
    } finally {
      setMerging(null);
    }
  };

  const handleMergeAll = async () => {
    if (!isAdmin) return;
    setConfirmMergeAll(false);
    setMergingAll(true);

    let totalAffected = 0;
    let merged = 0;
    let failed = 0;

    for (const group of remainingGroups) {
      const canonical = getCanonical(group);
      const sources = group.variants.filter((v) => v !== canonical);
      if (sources.length === 0) continue;

      try {
        const res = await fetch('/api/tags/bulk-merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources,
            target: canonical,
            type: 'ai',
          }),
        });
        const data = await res.json();
        if (res.ok) {
          totalAffected += data.affected ?? 0;
          merged++;
          setMergedGroups((prev) => new Set([...prev, group.canonical]));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    setMergingAll(false);
    if (merged > 0 && failed === 0) {
      toast.success(
        `Merged ${merged} duplicate group${merged !== 1 ? 's' : ''} (${totalAffected} items updated)`,
      );
      onMergeComplete();
    } else if (merged > 0 && failed > 0) {
      toast.warning(
        `Merged ${merged} group${merged !== 1 ? 's' : ''}, but ${failed} group${failed !== 1 ? 's' : ''} failed`,
      );
      onMergeComplete();
    } else {
      toast.error('No groups were merged');
    }
  };

  if (duplicates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Check className="size-8 text-tag-core" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          No duplicate tags found. All tags are unique.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with merge all button */}
      {isAdmin && remainingGroups.length > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {remainingGroups.length} duplicate group
            {remainingGroups.length !== 1 ? 's' : ''} remaining
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmMergeAll(true)}
            disabled={mergingAll}
          >
            {mergingAll ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Merge className="mr-2 size-4" />
            )}
            Merge all groups
          </Button>
        </div>
      )}

      {/* Duplicate groups */}
      {duplicates.map((group) => {
        const isMerged = mergedGroups.has(group.canonical);
        const canonical = getCanonical(group);

        return (
          <Card
            key={group.canonical}
            className={isMerged ? 'opacity-50' : undefined}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">
                    {isMerged ? (
                      <span className="flex items-center gap-2">
                        <Check
                          className="size-4 text-tag-core"
                          aria-hidden="true"
                        />
                        Merged
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <AlertTriangle
                          className="size-4 text-freshness-aging"
                          aria-hidden="true"
                        />
                        {group.variant_count} variants
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {group.total_usage} total usage
                    {group.total_usage !== 1 ? 's' : ''} across items
                  </CardDescription>
                </div>
                {isAdmin && !isMerged && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleMergeGroup(group)}
                    disabled={merging === group.canonical || mergingAll}
                  >
                    {merging === group.canonical ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Merge className="mr-2 size-4" />
                    )}
                    Merge
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Variants */}
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Variants
                </span>
                <div className="flex flex-wrap gap-2">
                  {group.variants.map((variant) => (
                    <Badge
                      key={variant}
                      variant={variant === canonical ? 'default' : 'outline'}
                      className="text-xs"
                    >
                      {variant}
                      {variant === canonical && (
                        <span className="sr-only"> (canonical)</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Canonical form editor */}
              {!isMerged && isAdmin && (
                <div className="space-y-1">
                  <label
                    htmlFor={`canonical-${group.canonical}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Merge into
                  </label>
                  <Input
                    id={`canonical-${group.canonical}`}
                    value={canonical}
                    onChange={(e) =>
                      setEditingCanonical((prev) => ({
                        ...prev,
                        [group.canonical]: e.target.value,
                      }))
                    }
                    className="h-8 text-sm"
                    aria-label={`Canonical form for ${group.canonical}`}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Merge All Confirmation Dialog */}
      <Dialog open={confirmMergeAll} onOpenChange={setConfirmMergeAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge All Duplicate Groups</DialogTitle>
            <DialogDescription>
              This will merge {remainingGroups.length} duplicate group
              {remainingGroups.length !== 1 ? 's' : ''} into their canonical
              forms. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmMergeAll(false)}>
              Cancel
            </Button>
            <Button onClick={handleMergeAll}>Merge all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
