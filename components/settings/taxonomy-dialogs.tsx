'use client';

import { Loader2 } from 'lucide-react';
import { formatDomainName } from '@/lib/taxonomy/taxonomy-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import type { AdminDomain, AdminSubtopic } from '@/hooks/use-taxonomy-admin';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TaxonomyDialogsProps {
  // Domain dialog
  domainDialogOpen: boolean;
  setDomainDialogOpen: (open: boolean) => void;
  editingDomain: AdminDomain | null;
  domainName: string;
  setDomainName: (value: string) => void;
  domainColour: string;
  setDomainColour: (value: string) => void;
  domainOrder: string;
  setDomainOrder: (value: string) => void;
  domainSaving: boolean;
  handleDomainSubmit: (e: React.FormEvent) => Promise<void>;

  // Subtopic dialog
  subtopicDialogOpen: boolean;
  setSubtopicDialogOpen: (open: boolean) => void;
  editingSubtopic: AdminSubtopic | null;
  subtopicName: string;
  setSubtopicName: (value: string) => void;
  subtopicOrder: string;
  setSubtopicOrder: (value: string) => void;
  subtopicSaving: boolean;
  handleSubtopicSubmit: (e: React.FormEvent) => Promise<void>;

  // Deactivation dialog
  deactivateDialogOpen: boolean;
  setDeactivateDialogOpen: (open: boolean) => void;
  deactivateTarget: { type: 'domain' | 'subtopic'; id: string; name: string } | null;
  handleDeactivate: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaxonomyDialogs({
  domainDialogOpen,
  setDomainDialogOpen,
  editingDomain,
  domainName,
  setDomainName,
  domainColour,
  setDomainColour,
  domainOrder,
  setDomainOrder,
  domainSaving,
  handleDomainSubmit,
  subtopicDialogOpen,
  setSubtopicDialogOpen,
  editingSubtopic,
  subtopicName,
  setSubtopicName,
  subtopicOrder,
  setSubtopicOrder,
  subtopicSaving,
  handleSubtopicSubmit,
  deactivateDialogOpen,
  setDeactivateDialogOpen,
  deactivateTarget,
  handleDeactivate,
}: TaxonomyDialogsProps) {
  return (
    <>
      {/* Domain dialog */}
      <Dialog open={domainDialogOpen} onOpenChange={setDomainDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDomain ? 'Edit Domain' : 'Add Domain'}
            </DialogTitle>
            <DialogDescription>
              {editingDomain
                ? 'Update this domain\'s configuration.'
                : 'Create a new taxonomy domain.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDomainSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="domain-name">Domain Name</Label>
              <Input
                id="domain-name"
                value={domainName}
                onChange={(e) => setDomainName(e.target.value)}
                placeholder="e.g. sustainability"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use kebab-case (e.g. &quot;product-feature&quot;).
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="domain-colour">Colour Key</Label>
              <Input
                id="domain-colour"
                value={domainColour}
                onChange={(e) => setDomainColour(e.target.value)}
                placeholder="e.g. sustainability"
              />
              <p className="text-xs text-muted-foreground">
                CSS variable key (maps to --domain-&#123;key&#125;-*). Leave empty for default.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="domain-order">Display Order</Label>
              <Input
                id="domain-order"
                type="number"
                min="0"
                max="999"
                value={domainOrder}
                onChange={(e) => setDomainOrder(e.target.value)}
                placeholder="Auto-assigned if empty"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDomainDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={domainSaving}>
                {domainSaving && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {editingDomain ? 'Save Changes' : 'Create Domain'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Subtopic dialog */}
      <Dialog open={subtopicDialogOpen} onOpenChange={setSubtopicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSubtopic ? 'Edit Subtopic' : 'Add Subtopic'}
            </DialogTitle>
            <DialogDescription>
              {editingSubtopic
                ? 'Update this subtopic\'s configuration.'
                : 'Create a new subtopic for this domain.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubtopicSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subtopic-name">Subtopic Name</Label>
              <Input
                id="subtopic-name"
                value={subtopicName}
                onChange={(e) => setSubtopicName(e.target.value)}
                placeholder="e.g. carbon-reporting"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use kebab-case (e.g. &quot;data-protection&quot;).
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subtopic-order">Display Order</Label>
              <Input
                id="subtopic-order"
                type="number"
                min="0"
                max="999"
                value={subtopicOrder}
                onChange={(e) => setSubtopicOrder(e.target.value)}
                placeholder="Auto-assigned if empty"
              />
              <p className="text-xs text-muted-foreground">
                Lower numbers appear first.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSubtopicDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={subtopicSaving}>
                {subtopicSaving && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {editingSubtopic ? 'Save Changes' : 'Create Subtopic'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivation confirmation dialog */}
      <AlertDialog open={deactivateDialogOpen} onOpenChange={setDeactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {deactivateTarget?.type === 'domain' ? 'Domain' : 'Subtopic'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>
                  Are you sure you want to deactivate{' '}
                  <strong>
                    &quot;{deactivateTarget ? formatDomainName(deactivateTarget.name) : ''}&quot;
                  </strong>
                  ?
                </p>
                <div>
                  <p className="font-medium text-foreground">This will:</p>
                  <ul className="ml-4 mt-1 list-disc text-sm">
                    <li>Hide it from browse filters and classification dropdowns</li>
                    {deactivateTarget?.type === 'domain' && (
                      <li>Hide all its subtopics</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground">It will NOT:</p>
                  <ul className="ml-4 mt-1 list-disc text-sm">
                    <li>Delete any content classified under this {deactivateTarget?.type}</li>
                    <li>Remove classifications from existing content items</li>
                  </ul>
                </div>
                <p className="text-sm">You can reactivate it at any time.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
