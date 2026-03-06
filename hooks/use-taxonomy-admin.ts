'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminDomain {
  id: string;
  name: string;
  display_order: number;
  colour: string | null;
  is_active: boolean;
  subtopic_count: number;
}

export interface AdminSubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface UseTaxonomyAdminParams {
  refresh: () => void;
}

export interface UseTaxonomyAdminReturn {
  // Data
  domains: AdminDomain[];
  loading: boolean;
  expandedDomains: Set<string>;
  subtopicsByDomain: Map<string, AdminSubtopic[]>;

  // Domain dialog state
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

  // Subtopic dialog state
  subtopicDialogOpen: boolean;
  setSubtopicDialogOpen: (open: boolean) => void;
  editingSubtopic: AdminSubtopic | null;
  subtopicName: string;
  setSubtopicName: (value: string) => void;
  subtopicOrder: string;
  setSubtopicOrder: (value: string) => void;
  subtopicSaving: boolean;

  // Deactivation dialog state
  deactivateDialogOpen: boolean;
  setDeactivateDialogOpen: (open: boolean) => void;
  deactivateTarget: { type: 'domain' | 'subtopic'; id: string; name: string } | null;

  // Screen reader announcement
  announcement: string;

  // Handlers
  toggleDomain: (domainId: string) => void;
  openAddDomain: () => void;
  openEditDomain: (domain: AdminDomain) => void;
  handleDomainSubmit: (e: React.FormEvent) => Promise<void>;
  openAddSubtopic: (domainId: string) => void;
  openEditSubtopic: (subtopic: AdminSubtopic) => void;
  handleSubtopicSubmit: (e: React.FormEvent) => Promise<void>;
  confirmDeactivate: (type: 'domain' | 'subtopic', id: string, name: string) => void;
  handleDeactivate: () => Promise<void>;
  handleReactivate: (type: 'domain' | 'subtopic', id: string, domainId?: string) => Promise<void>;
  handleMoveDomain: (domainId: string, direction: 'up' | 'down') => Promise<void>;
  handleMoveSubtopic: (domainId: string, subtopicId: string, direction: 'up' | 'down') => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTaxonomyAdmin({
  refresh,
}: UseTaxonomyAdminParams): UseTaxonomyAdminReturn {
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

  // Screen reader announcement
  const [announcement, setAnnouncement] = useState('');

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
        setAnnouncement(`Domain '${domainName.trim()}' updated`);
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
        setAnnouncement(`Domain '${domainName.trim()}' created`);
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
        setAnnouncement(`Subtopic '${subtopicName.trim()}' updated`);
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
        setAnnouncement(`Subtopic '${subtopicName.trim()}' created`);
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
      setAnnouncement(`${type === 'domain' ? 'Domain' : 'Subtopic'} '${deactivateTarget.name}' deactivated`);
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
      setAnnouncement(`${type === 'domain' ? 'Domain' : 'Subtopic'} reactivated`);

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
    } catch (err) {
      console.error('Failed to reorder domains:', err);
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
    } catch (err) {
      console.error('Failed to reorder subtopics:', err);
      toast.error('Failed to reorder subtopics');
      fetchSubtopics(domainId); // Rollback
    }
  }

  return {
    // Data
    domains,
    loading,
    expandedDomains,
    subtopicsByDomain,

    // Domain dialog state
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

    // Subtopic dialog state
    subtopicDialogOpen,
    setSubtopicDialogOpen,
    editingSubtopic,
    subtopicName,
    setSubtopicName,
    subtopicOrder,
    setSubtopicOrder,
    subtopicSaving,

    // Deactivation dialog state
    deactivateDialogOpen,
    setDeactivateDialogOpen,
    deactivateTarget,

    // Screen reader announcement
    announcement,

    // Handlers
    toggleDomain,
    openAddDomain,
    openEditDomain,
    handleDomainSubmit,
    openAddSubtopic,
    openEditSubtopic,
    handleSubtopicSubmit,
    confirmDeactivate,
    handleDeactivate,
    handleReactivate,
    handleMoveDomain,
    handleMoveSubtopic,
  };
}
