'use client';

import { useState } from 'react';
import { Loader2, Merge } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { VALID_ENTITY_TYPES } from '@/lib/validation/schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityForMerge {
  canonical_name: string;
  entity_type: string;
  mention_count: number;
}

interface MergeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entities: EntityForMerge[];
  onMergeComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MergeModal({
  open,
  onOpenChange,
  entities,
  onMergeComplete,
}: MergeModalProps) {
  const [targetName, setTargetName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill with the entity that has the most mentions
  const topEntity = entities.length > 0
    ? entities.reduce(
        (best, e) => (e.mention_count > best.mention_count ? e : best),
        entities[0],
      )
    : undefined;

  // Initialise defaults when modal opens with new entities
  const effectiveTarget = targetName || topEntity?.canonical_name || '';
  const effectiveType = entityType || topEntity?.entity_type || '';

  const totalMentions = entities.reduce((sum, e) => sum + e.mention_count, 0);

  async function handleMerge() {
    if (!effectiveTarget.trim() || !effectiveType) return;
    setLoading(true);
    try {
      const sources = entities
        .map((e) => e.canonical_name)
        .filter((n) => n !== effectiveTarget.trim());

      const res = await fetch('/api/entities/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          target: effectiveTarget.trim(),
          entity_type: effectiveType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to merge entities');

      toast.success(
        `Merged ${entities.length} entities into "${effectiveTarget.trim()}" (${data.mentions_updated} mentions updated)`,
      );
      onOpenChange(false);
      setTargetName('');
      setEntityType('');
      onMergeComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to merge entities');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    onOpenChange(false);
    setTargetName('');
    setEntityType('');
  }

  if (entities.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Merge className="size-5" />
            Merge Entities
          </DialogTitle>
          <DialogDescription>
            Merge {entities.length} entities into a single canonical form. All
            mentions and relationships will be updated.
          </DialogDescription>
        </DialogHeader>

        {/* Selected entities */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Entities to merge:</p>
          <div className="flex flex-wrap gap-2">
            {entities.map((e) => (
              <Badge key={e.canonical_name} variant="outline" className="gap-1.5">
                {e.canonical_name}
                <span className="text-muted-foreground">
                  ({e.mention_count})
                </span>
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            This will update {totalMentions} mentions across {entities.length} entities
            and consolidate relationships.
          </p>
        </div>

        {/* Target name */}
        <div className="space-y-1.5">
          <label
            htmlFor="merge-target"
            className="text-sm font-medium"
          >
            Canonical name for merged entity
          </label>
          <Input
            id="merge-target"
            value={effectiveTarget}
            onChange={(e) => setTargetName(e.target.value)}
            placeholder="Enter canonical name..."
          />
        </div>

        {/* Entity type */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Entity type</label>
          <Select
            value={effectiveType}
            onValueChange={(v) => setEntityType(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select type..." />
            </SelectTrigger>
            <SelectContent>
              {VALID_ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={loading || !effectiveTarget.trim() || !effectiveType}
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Merge {entities.length} entities
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
