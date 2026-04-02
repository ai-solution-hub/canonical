'use client';

import { useState } from 'react';
import { Loader2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SplitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canonicalName: string;
  variantNames: string[];
  onSplitComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SplitModal({
  open,
  onOpenChange,
  canonicalName,
  variantNames,
  onSplitComplete,
}: SplitModalProps) {
  const [selectedVariants, setSelectedVariants] = useState<Set<string>>(
    new Set(),
  );
  const [newCanonicalName, setNewCanonicalName] = useState('');
  const [loading, setLoading] = useState(false);

  function toggleVariant(name: string) {
    setSelectedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  async function handleSplit() {
    if (selectedVariants.size === 0 || !newCanonicalName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/entities/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical_name: canonicalName,
          variant_names: Array.from(selectedVariants),
          new_canonical_name: newCanonicalName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to split entity');

      toast.success(
        `Split ${data.mentions_moved} mentions into "${newCanonicalName.trim()}"`,
      );
      handleClose();
      onSplitComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to split entity',
      );
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    onOpenChange(false);
    setSelectedVariants(new Set());
    setNewCanonicalName('');
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="size-5" />
            Split Entity
          </DialogTitle>
          <DialogDescription>
            Select variants of &ldquo;{canonicalName}&rdquo; to split into a new
            entity.
          </DialogDescription>
        </DialogHeader>

        {/* Variant selection */}
        <div className="space-y-2">
          <p className="text-sm font-medium">
            Select variants to move ({selectedVariants.size} selected):
          </p>
          <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border p-2">
            {variantNames.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No variants found for this entity.
              </p>
            ) : (
              variantNames.map((name) => (
                <label
                  key={name}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={selectedVariants.has(name)}
                    onCheckedChange={() => toggleVariant(name)}
                  />
                  <span>{name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* New canonical name */}
        <div className="space-y-1.5">
          <label htmlFor="split-name" className="text-sm font-medium">
            New canonical name for split variants
          </label>
          <Input
            id="split-name"
            value={newCanonicalName}
            onChange={(e) => setNewCanonicalName(e.target.value)}
            placeholder="Enter new canonical name..."
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSplit}
            disabled={
              loading ||
              selectedVariants.size === 0 ||
              !newCanonicalName.trim() ||
              newCanonicalName.trim() === canonicalName
            }
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            Split {selectedVariants.size} variant
            {selectedVariants.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
