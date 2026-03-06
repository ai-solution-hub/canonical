'use client';

import {
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Loader2,
  Tags,
} from 'lucide-react';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { formatDomainName, formatSubtopic } from '@/lib/taxonomy-format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useTaxonomyAdmin } from '@/hooks/use-taxonomy-admin';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TaxonomySection() {
  const { refresh } = useTaxonomy();
  const t = useTaxonomyAdmin({ refresh });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (t.loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Taxonomy Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Manage knowledge base domains and subtopics. Deactivated items are
            hidden from filters but existing content retains its classification.
          </p>
        </div>
        <Button size="sm" onClick={t.openAddDomain}>
          <Plus className="mr-1.5 size-4" />
          Add Domain
        </Button>
      </div>

      {t.domains.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Tags className="size-8" />
            <p className="text-sm">No domains configured yet.</p>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {t.domains.map((domain, idx) => {
            const isExpanded = t.expandedDomains.has(domain.id);
            const subs = t.subtopicsByDomain.get(domain.id) ?? [];

            return (
              <Card key={domain.id} className="overflow-hidden">
                {/* Domain header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => t.toggleDomain(domain.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={isExpanded ? 'Collapse subtopics' : 'Expand subtopics'}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {formatDomainName(domain.name)}
                      </p>
                      <Badge
                        variant={domain.is_active ? 'secondary' : 'outline'}
                        className="shrink-0"
                      >
                        {domain.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {domain.colour && (
                        <span>
                          Colour: <code className="rounded bg-muted px-1">{domain.colour}</code>
                        </span>
                      )}
                      <span>Order: {domain.display_order}</span>
                      <span>
                        {domain.subtopic_count}{' '}
                        {domain.subtopic_count === 1 ? 'subtopic' : 'subtopics'}
                      </span>
                    </div>
                  </div>

                  {/* Reorder buttons */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={idx === 0}
                      onClick={() => t.handleMoveDomain(domain.id, 'up')}
                      aria-label="Move domain up"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={idx === t.domains.length - 1}
                      onClick={() => t.handleMoveDomain(domain.id, 'down')}
                      aria-label="Move domain down"
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>

                  {/* Edit / Activate-Deactivate */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => t.openEditDomain(domain)}
                    >
                      Edit
                    </Button>
                    {domain.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          t.confirmDeactivate('domain', domain.id, domain.name)
                        }
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          t.handleReactivate('domain', domain.id)
                        }
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>

                {/* Subtopics list (expanded) */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3">
                    {subs.length === 0 ? (
                      <p className="py-2 text-center text-xs text-muted-foreground">
                        No subtopics yet
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {subs.map((sub, subIdx) => (
                          <div
                            key={sub.id}
                            className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm">
                                  {formatSubtopic(sub.name)}
                                </p>
                                <Badge
                                  variant={sub.is_active ? 'secondary' : 'outline'}
                                  className="shrink-0 text-[10px]"
                                >
                                  {sub.is_active ? 'Active' : 'Inactive'}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Order: {sub.display_order}
                              </p>
                            </div>

                            {/* Reorder */}
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={subIdx === 0}
                                onClick={() =>
                                  t.handleMoveSubtopic(domain.id, sub.id, 'up')
                                }
                                aria-label="Move subtopic up"
                              >
                                <ArrowUp className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                disabled={subIdx === subs.length - 1}
                                onClick={() =>
                                  t.handleMoveSubtopic(domain.id, sub.id, 'down')
                                }
                                aria-label="Move subtopic down"
                              >
                                <ArrowDown className="size-3" />
                              </Button>
                            </div>

                            {/* Edit / Activate-Deactivate */}
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => t.openEditSubtopic(sub)}
                              >
                                Edit
                              </Button>
                              {sub.is_active ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-destructive hover:text-destructive"
                                  onClick={() =>
                                    t.confirmDeactivate('subtopic', sub.id, sub.name)
                                  }
                                >
                                  Deactivate
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() =>
                                    t.handleReactivate('subtopic', sub.id, domain.id)
                                  }
                                >
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => t.openAddSubtopic(domain.id)}
                      >
                        <Plus className="mr-1.5 size-3.5" />
                        Add Subtopic
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Domain dialog */}
      <Dialog open={t.domainDialogOpen} onOpenChange={t.setDomainDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t.editingDomain ? 'Edit Domain' : 'Add Domain'}
            </DialogTitle>
            <DialogDescription>
              {t.editingDomain
                ? 'Update this domain\'s configuration.'
                : 'Create a new taxonomy domain.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={t.handleDomainSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="domain-name">Domain Name</Label>
              <Input
                id="domain-name"
                value={t.domainName}
                onChange={(e) => t.setDomainName(e.target.value)}
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
                value={t.domainColour}
                onChange={(e) => t.setDomainColour(e.target.value)}
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
                value={t.domainOrder}
                onChange={(e) => t.setDomainOrder(e.target.value)}
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
                onClick={() => t.setDomainDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={t.domainSaving}>
                {t.domainSaving && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {t.editingDomain ? 'Save Changes' : 'Create Domain'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Subtopic dialog */}
      <Dialog open={t.subtopicDialogOpen} onOpenChange={t.setSubtopicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t.editingSubtopic ? 'Edit Subtopic' : 'Add Subtopic'}
            </DialogTitle>
            <DialogDescription>
              {t.editingSubtopic
                ? 'Update this subtopic\'s configuration.'
                : 'Create a new subtopic for this domain.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={t.handleSubtopicSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subtopic-name">Subtopic Name</Label>
              <Input
                id="subtopic-name"
                value={t.subtopicName}
                onChange={(e) => t.setSubtopicName(e.target.value)}
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
                value={t.subtopicOrder}
                onChange={(e) => t.setSubtopicOrder(e.target.value)}
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
                onClick={() => t.setSubtopicDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={t.subtopicSaving}>
                {t.subtopicSaving && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                {t.editingSubtopic ? 'Save Changes' : 'Create Subtopic'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivation confirmation dialog */}
      <AlertDialog open={t.deactivateDialogOpen} onOpenChange={t.setDeactivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {t.deactivateTarget?.type === 'domain' ? 'Domain' : 'Subtopic'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <p>
                  Are you sure you want to deactivate{' '}
                  <strong>
                    &quot;{t.deactivateTarget ? formatDomainName(t.deactivateTarget.name) : ''}&quot;
                  </strong>
                  ?
                </p>
                <div>
                  <p className="font-medium text-foreground">This will:</p>
                  <ul className="ml-4 mt-1 list-disc text-sm">
                    <li>Hide it from browse filters and classification dropdowns</li>
                    {t.deactivateTarget?.type === 'domain' && (
                      <li>Hide all its subtopics</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground">It will NOT:</p>
                  <ul className="ml-4 mt-1 list-disc text-sm">
                    <li>Delete any content classified under this {t.deactivateTarget?.type}</li>
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
              onClick={t.handleDeactivate}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Screen reader announcements */}
      <div aria-live="polite" className="sr-only">
        {t.announcement}
      </div>
    </div>
  );
}
