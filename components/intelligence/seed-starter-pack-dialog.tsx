'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PackagePlus, Check, AlertTriangle, Info } from 'lucide-react';
import { STARTER_PACKS } from '@/lib/intelligence/starter-packs';
import type { StarterPack } from '@/lib/intelligence/starter-packs';
import { useSeedStarterPack } from '@/hooks/intelligence/use-seed-starter-pack';
import type { SeedStarterPackResult } from '@/hooks/intelligence/use-seed-starter-pack';

interface SeedStarterPackDialogProps {
  workspaceId: string;
}

export function SeedStarterPackDialog({
  workspaceId,
}: SeedStarterPackDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedPack, setSelectedPack] = useState<StarterPack | null>(null);
  const [result, setResult] = useState<SeedStarterPackResult | null>(null);
  const seedMutation = useSeedStarterPack(workspaceId);

  const handleSeed = () => {
    if (!selectedPack) return;
    setResult(null);
    seedMutation.mutate(selectedPack.id, {
      onSuccess: (data) => {
        setResult(data);
      },
    });
  };

  const handleClose = () => {
    setOpen(false);
    // Reset state after close animation
    setTimeout(() => {
      setSelectedPack(null);
      setResult(null);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : handleClose())}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PackagePlus className="mr-1.5 size-4" />
          Seed Starter Pack
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Seed Starter Pack</DialogTitle>
          <DialogDescription>
            Quickly populate this workspace with curated feeds for a specific
            sector. Existing feeds will not be duplicated.
          </DialogDescription>
        </DialogHeader>

        {/* Result view */}
        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg border bg-card p-4">
              <h4 className="mb-2 text-sm font-medium text-foreground">
                Seeding complete: {result.starter_pack_name}
              </h4>
              {result.seeded.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  <span>
                    {result.seeded.length} feed
                    {result.seeded.length === 1 ? '' : 's'} added
                  </span>
                </div>
              )}
              {result.skipped_existing.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    {result.skipped_existing.length} feed
                    {result.skipped_existing.length === 1 ? '' : 's'} already
                    existed
                  </span>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {result.failed.length} feed
                    {result.failed.length === 1 ? '' : 's'} failed
                  </span>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          /* Pack selection view */
          <div className="space-y-3">
            <div className="grid gap-2">
              {STARTER_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedPack(pack)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    selectedPack?.id === pack.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="text-sm font-medium text-foreground">
                    {pack.name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {pack.description}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground/70">
                    {pack.feeds.length} feed{pack.feeds.length === 1 ? '' : 's'}
                  </div>
                </button>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSeed}
                disabled={!selectedPack || seedMutation.isPending}
              >
                {seedMutation.isPending ? 'Seeding...' : 'Seed Feeds'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
