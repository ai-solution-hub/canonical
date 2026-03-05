'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Loader2,
  Tags,
} from 'lucide-react';
import { toast } from 'sonner';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminDomain {
  id: string;
  name: string;
  display_order: number;
  colour: string | null;
  is_active: boolean;
  subtopic_count: number;
}

interface AdminSubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TaxonomySection() {
  const { refresh } = useTaxonomy();
  const [domains, setDomains] = useState<AdminDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [subtopicsByDomain, setSubtopicsByDomain] = useState<Map<string, AdminSubtopic[]>>(
    new Map(),
  );

  // Domain dialog state
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<AdminDomain | null>(null);
  const [domainName, setDomainName] = useState('');
  const [domainColour, setDomainColour] = useState('');
  const [domainOrder, setDomainOrder] = useState('');
  const [domainSaving, setDomainSaving] = useState(false);

  // Subtopic dialog state
  const [subtopicDialogOpen, setSubtopicDialogOpen] = useState(false);
  const [editingSubtopic, setEditingSubtopic] = useState<AdminSubtopic | null>(null);
  const [subtopicDomainId, setSubtopicDomainId] = useState('');
  const [subtopicName, setSubtopicName] = useState('');
  const [subtopicOrder, setSubtopicOrder] = useState('');
  const [subtopicSaving, setSubtopicSaving] = useState(false);

  // Deactivation dialog state
  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    type: 'domain' | 'subtopic';
    id: string;
    name: string;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchDomains = useCallback(async () => {
    try {
      const res = await fetch('/api/taxonomy/domains');
      if (!res.ok) throw new Error('Failed to load domains');
      const data: AdminDomain[] = await res.json();
      setDomains(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load taxonomy domains',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubtopics = useCallback(async (domainId: string) => {
    try {
      // We fetch subtopics for a domain directly from Supabase via our own API
      // by querying the admin domains list — but subtopics need their own fetch.
      // For simplicity, we'll use a direct Supabase client call here since we
      // already have admin access (proven by the domain list loading).
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { data, error } = await supabase
        .from('taxonomy_subtopics')
        .select('id, domain_id, name, display_order, is_active')
        .eq('domain_id', domainId)
        .order('display_order', { ascending: true });

      if (error) throw error;

      setSubtopicsByDomain((prev) => {
        const next = new Map(prev);
        next.set(domainId, (data ?? []) as AdminSubtopic[]);
        return next;
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load subtopics',
      );
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  // -----------------------------------------------------------------------
  // Expand / collapse
  // -----------------------------------------------------------------------

  function toggleDomain(domainId: string) {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domainId)) {
        next.delete(domainId);
      } else {
        next.add(domainId);
        // Fetch subtopics if not already loaded
        if (!subtopicsByDomain.has(domainId)) {
          fetchSubtopics(domainId);
        }
      }
      return next;
    });
  }

  // -----------------------------------------------------------------------
  // Domain CRUD
  // -----------------------------------------------------------------------

  function openAddDomain() {
    setEditingDomain(null);
    setDomainName('');
    setDomainColour('');
    setDomainOrder('');
    setDomainDialogOpen(true);
  }

  function openEditDomain(domain: AdminDomain) {
    setEditingDomain(domain);
    setDomainName(domain.name);
    setDomainColour(domain.colour ?? '');
    setDomainOrder(String(domain.display_order));
    setDomainDialogOpen(true);
  }

  async function handleDomainSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainName.trim()) return;
    setDomainSaving(true);

    try {
      if (editingDomain) {
        // Update
        const body: Record<string, unknown> = {};
        if (domainName.trim() !== editingDomain.name) body.name = domainName.trim();
        if ((domainColour.trim() || null) !== editingDomain.colour) {
          body.colour = domainColour.trim() || null;
        }
        const orderVal = parseInt(domainOrder, 10);
        if (!isNaN(orderVal) && orderVal !== editingDomain.display_order) {
          body.display_order = orderVal;
        }

        if (Object.keys(body).length === 0) {
          setDomainDialogOpen(false);
          return;
        }

        const res = await fetch(`/api/taxonomy/domains/${editingDomain.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update domain');
        }

        toast.success('Domain updated');
      } else {
        // Create
        const body: Record<string, unknown> = { name: domainName.trim() };
        if (domainColour.trim()) body.colour = domainColour.trim();
        const orderVal = parseInt(domainOrder, 10);
        if (!isNaN(orderVal)) body.display_order = orderVal;

        const res = await fetch('/api/taxonomy/domains', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create domain');
        }

        toast.success('Domain created');
      }

      setDomainDialogOpen(false);
      fetchDomains();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save domain');
    } finally {
      setDomainSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Subtopic CRUD
  // -----------------------------------------------------------------------

  function openAddSubtopic(domainId: string) {
    setEditingSubtopic(null);
    setSubtopicDomainId(domainId);
    setSubtopicName('');
    setSubtopicOrder('');
    setSubtopicDialogOpen(true);
  }

  function openEditSubtopic(subtopic: AdminSubtopic) {
    setEditingSubtopic(subtopic);
    setSubtopicDomainId(subtopic.domain_id);
    setSubtopicName(subtopic.name);
    setSubtopicOrder(String(subtopic.display_order));
    setSubtopicDialogOpen(true);
  }

  async function handleSubtopicSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subtopicName.trim()) return;
    setSubtopicSaving(true);

    try {
      if (editingSubtopic) {
        // Update
        const body: Record<string, unknown> = {};
        if (subtopicName.trim() !== editingSubtopic.name) body.name = subtopicName.trim();
        const orderVal = parseInt(subtopicOrder, 10);
        if (!isNaN(orderVal) && orderVal !== editingSubtopic.display_order) {
          body.display_order = orderVal;
        }

        if (Object.keys(body).length === 0) {
          setSubtopicDialogOpen(false);
          return;
        }

        const res = await fetch(`/api/taxonomy/subtopics/${editingSubtopic.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update subtopic');
        }

        toast.success('Subtopic updated');
      } else {
        // Create
        const body: Record<string, unknown> = {
          domain_id: subtopicDomainId,
          name: subtopicName.trim(),
        };
        const orderVal = parseInt(subtopicOrder, 10);
        if (!isNaN(orderVal)) body.display_order = orderVal;

        const res = await fetch('/api/taxonomy/subtopics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create subtopic');
        }

        toast.success('Subtopic created');
      }

      setSubtopicDialogOpen(false);
      fetchSubtopics(subtopicDomainId);
      fetchDomains(); // Refresh subtopic counts
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save subtopic');
    } finally {
      setSubtopicSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Activation / deactivation
  // -----------------------------------------------------------------------

  function confirmDeactivate(type: 'domain' | 'subtopic', id: string, name: string) {
    setDeactivateTarget({ type, id, name });
    setDeactivateDialogOpen(true);
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return;

    const { type, id } = deactivateTarget;
    const endpoint =
      type === 'domain'
        ? `/api/taxonomy/domains/${id}`
        : `/api/taxonomy/subtopics/${id}`;

    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to deactivate ${type}`);
      }

      toast.success(`${type === 'domain' ? 'Domain' : 'Subtopic'} deactivated`);
      setDeactivateDialogOpen(false);
      setDeactivateTarget(null);

      if (type === 'domain') {
        fetchDomains();
      } else {
        // Find which domain this subtopic belongs to and refresh
        const domainId = Array.from(subtopicsByDomain.entries()).find(
          ([, subs]) => subs.some((s) => s.id === id),
        )?.[0];
        if (domainId) fetchSubtopics(domainId);
        fetchDomains();
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to deactivate ${type}`);
    }
  }

  async function handleReactivate(type: 'domain' | 'subtopic', id: string, domainId?: string) {
    const endpoint =
      type === 'domain'
        ? `/api/taxonomy/domains/${id}`
        : `/api/taxonomy/subtopics/${id}`;

    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to reactivate ${type}`);
      }

      toast.success(`${type === 'domain' ? 'Domain' : 'Subtopic'} reactivated`);

      if (type === 'domain') {
        fetchDomains();
      } else if (domainId) {
        fetchSubtopics(domainId);
        fetchDomains();
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to reactivate ${type}`);
    }
  }

  // -----------------------------------------------------------------------
  // Reordering
  // -----------------------------------------------------------------------

  async function handleMoveDomain(domainId: string, direction: 'up' | 'down') {
    const idx = domains.findIndex((d) => d.id === domainId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= domains.length) return;

    const current = domains[idx];
    const swap = domains[swapIdx];

    // Swap display orders
    const items = [
      { id: current.id, display_order: swap.display_order },
      { id: swap.id, display_order: current.display_order },
    ];

    // Optimistic update
    const updated = [...domains];
    updated[idx] = { ...current, display_order: swap.display_order };
    updated[swapIdx] = { ...swap, display_order: current.display_order };
    updated.sort((a, b) => a.display_order - b.display_order);
    setDomains(updated);

    try {
      const res = await fetch('/api/taxonomy/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'domain', items }),
      });

      if (!res.ok) {
        throw new Error('Failed to reorder');
      }
      refresh();
    } catch {
      toast.error('Failed to reorder domains');
      fetchDomains(); // Rollback
    }
  }

  async function handleMoveSubtopic(
    domainId: string,
    subtopicId: string,
    direction: 'up' | 'down',
  ) {
    const subs = subtopicsByDomain.get(domainId) ?? [];
    const idx = subs.findIndex((s) => s.id === subtopicId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= subs.length) return;

    const current = subs[idx];
    const swap = subs[swapIdx];

    const items = [
      { id: current.id, display_order: swap.display_order },
      { id: swap.id, display_order: current.display_order },
    ];

    // Optimistic update
    const updated = [...subs];
    updated[idx] = { ...current, display_order: swap.display_order };
    updated[swapIdx] = { ...swap, display_order: current.display_order };
    updated.sort((a, b) => a.display_order - b.display_order);
    setSubtopicsByDomain((prev) => {
      const next = new Map(prev);
      next.set(domainId, updated);
      return next;
    });

    try {
      const res = await fetch('/api/taxonomy/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'subtopic', domain_id: domainId, items }),
      });

      if (!res.ok) {
        throw new Error('Failed to reorder');
      }
      refresh();
    } catch {
      toast.error('Failed to reorder subtopics');
      fetchSubtopics(domainId); // Rollback
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
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
        <Button size="sm" onClick={openAddDomain}>
          <Plus className="mr-1.5 size-4" />
          Add Domain
        </Button>
      </div>

      {domains.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Tags className="size-8" />
            <p className="text-sm">No domains configured yet.</p>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {domains.map((domain, idx) => {
            const isExpanded = expandedDomains.has(domain.id);
            const subs = subtopicsByDomain.get(domain.id) ?? [];

            return (
              <Card key={domain.id} className="overflow-hidden">
                {/* Domain header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleDomain(domain.id)}
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
                      onClick={() => handleMoveDomain(domain.id, 'up')}
                      aria-label="Move domain up"
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={idx === domains.length - 1}
                      onClick={() => handleMoveDomain(domain.id, 'down')}
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
                      onClick={() => openEditDomain(domain)}
                    >
                      Edit
                    </Button>
                    {domain.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          confirmDeactivate('domain', domain.id, domain.name)
                        }
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleReactivate('domain', domain.id)
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
                                  handleMoveSubtopic(domain.id, sub.id, 'up')
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
                                  handleMoveSubtopic(domain.id, sub.id, 'down')
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
                                onClick={() => openEditSubtopic(sub)}
                              >
                                Edit
                              </Button>
                              {sub.is_active ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-destructive hover:text-destructive"
                                  onClick={() =>
                                    confirmDeactivate('subtopic', sub.id, sub.name)
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
                                    handleReactivate('subtopic', sub.id, domain.id)
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
                        onClick={() => openAddSubtopic(domain.id)}
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
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
