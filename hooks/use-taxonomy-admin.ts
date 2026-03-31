'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';
import type { TaxonomyProvenance } from '@/types/taxonomy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { TaxonomyProvenance };

export interface AdminDomain {
  id: string;
  name: string;
  display_order: number;
  colour: string | null;
  key_signal: string | null;
  is_active: boolean;
  subtopic_count: number;
  provenance: TaxonomyProvenance;
}

export interface AdminSubtopic {
  id: string;
  domain_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  provenance: TaxonomyProvenance;
  description: string | null;
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
  domainKeySignal: string;
  setDomainKeySignal: (value: string) => void;
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
  handleAcceptRecommended: (type: 'domain' | 'subtopic', id: string, domainId?: string) => Promise<void>;
  handleRejectRecommended: (type: 'domain' | 'subtopic', id: string, name: string, domainId?: string) => Promise<void>;
  handleMoveDomain: (domainId: string, direction: 'up' | 'down') => Promise<void>;
  handleMoveSubtopic: (domainId: string, subtopicId: string, direction: 'up' | 'down') => Promise<void>;
}

// ---------------------------------------------------------------------------
// Standalone fetcher for subtopics (used by queryFn and ensureQueryData)
// ---------------------------------------------------------------------------

async function fetchSubtopicsForDomain(domainId: string): Promise<AdminSubtopic[]> {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { data, error } = await supabase
    .from('taxonomy_subtopics')
    .select('id, domain_id, name, display_order, is_active, provenance, description')
    .eq('domain_id', domainId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminSubtopic[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTaxonomyAdmin({
  refresh,
}: UseTaxonomyAdminParams): UseTaxonomyAdminReturn {
  const queryClient = useQueryClient();

  // -----------------------------------------------------------------------
  // Data fetching — domains via useQuery
  // -----------------------------------------------------------------------

  const {
    data: domains = [],
    isLoading: loading,
  } = useQuery({
    queryKey: queryKeys.taxonomy.adminDomains,
    queryFn: async () => {
      try {
        return await fetchJson<AdminDomain[]>('/api/taxonomy/domains');
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to load taxonomy domains',
        );
        throw err;
      }
    },
    staleTime: 30_000,
  });

  // -----------------------------------------------------------------------
  // Expand / collapse — subtopics via ensureQueryData + cache version
  // -----------------------------------------------------------------------

  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  // Track a counter to force subtopicsByDomain recomputation after cache updates
  const [subtopicCacheVersion, setSubtopicCacheVersion] = useState(0);

  const subtopicsByDomain = useMemo(() => {
    // subtopicCacheVersion is in the deps to trigger recomputation after mutations
    void subtopicCacheVersion;
    const map = new Map<string, AdminSubtopic[]>();
    for (const domainId of expandedDomains) {
      const cached = queryClient.getQueryData<AdminSubtopic[]>(
        queryKeys.taxonomy.adminSubtopics(domainId),
      );
      if (cached) map.set(domainId, cached);
    }
    return map;
  }, [expandedDomains, queryClient, subtopicCacheVersion]);

  const toggleDomain = useCallback(
    (domainId: string) => {
      const isCurrentlyExpanded = expandedDomains.has(domainId);
      setExpandedDomains((prev) => {
        const next = new Set(prev);
        if (next.has(domainId)) {
          next.delete(domainId);
        } else {
          next.add(domainId);
        }
        return next;
      });

      if (!isCurrentlyExpanded) {
        queryClient
          .ensureQueryData({
            queryKey: queryKeys.taxonomy.adminSubtopics(domainId),
            queryFn: () => fetchSubtopicsForDomain(domainId),
            staleTime: 60_000,
          })
          .then(() => {
            setSubtopicCacheVersion((v) => v + 1);
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : 'Failed to load subtopics',
            );
          });
      }
    },
    [expandedDomains, queryClient],
  );

  // -----------------------------------------------------------------------
  // Domain dialog state (pure UI — stays as useState)
  // -----------------------------------------------------------------------

  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<AdminDomain | null>(null);
  const [domainName, setDomainName] = useState('');
  const [domainColour, setDomainColour] = useState('');
  const [domainOrder, setDomainOrder] = useState('');
  const [domainKeySignal, setDomainKeySignal] = useState('');

  // -----------------------------------------------------------------------
  // Subtopic dialog state (pure UI — stays as useState)
  // -----------------------------------------------------------------------

  const [subtopicDialogOpen, setSubtopicDialogOpen] = useState(false);
  const [editingSubtopic, setEditingSubtopic] = useState<AdminSubtopic | null>(null);
  const [subtopicDomainId, setSubtopicDomainId] = useState('');
  const [subtopicName, setSubtopicName] = useState('');
  const [subtopicOrder, setSubtopicOrder] = useState('');

  // -----------------------------------------------------------------------
  // Screen reader announcement
  // -----------------------------------------------------------------------

  const [announcement, setAnnouncement] = useState('');

  // -----------------------------------------------------------------------
  // Deactivation dialog state
  // -----------------------------------------------------------------------

  const [deactivateDialogOpen, setDeactivateDialogOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{
    type: 'domain' | 'subtopic';
    id: string;
    name: string;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Shared invalidation helper
  // -----------------------------------------------------------------------

  const invalidateAfterMutation = useCallback(
    async (domainId?: string) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.taxonomy.adminDomains });
      if (domainId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.taxonomy.adminSubtopics(domainId),
        });
        setSubtopicCacheVersion((v) => v + 1);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.taxonomy.all });
      refresh();
    },
    [queryClient, refresh],
  );

  // -----------------------------------------------------------------------
  // Domain save mutation (create + update)
  // -----------------------------------------------------------------------

  const domainSaveMutation = useMutation({
    mutationFn: (params: {
      id?: string;
      body: Record<string, unknown>;
      name: string;
    }) => {
      if (params.id) {
        return mutationFetchJson(
          `/api/taxonomy/domains/${params.id}`,
          params.body,
          { method: 'PATCH' },
        );
      }
      return mutationFetchJson('/api/taxonomy/domains', params.body);
    },
    onSuccess: (_data, variables) => {
      const action = variables.id ? 'updated' : 'created';
      toast.success(`Domain ${action}`);
      setAnnouncement(`Domain '${variables.name}' ${action}`);
      setDomainDialogOpen(false);
      invalidateAfterMutation();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save domain',
      );
    },
  });

  const domainSaving = domainSaveMutation.isPending;

  // -----------------------------------------------------------------------
  // Subtopic save mutation (create + update)
  // -----------------------------------------------------------------------

  const subtopicSaveMutation = useMutation({
    mutationFn: (params: {
      id?: string;
      domainId: string;
      body: Record<string, unknown>;
      name: string;
    }) => {
      if (params.id) {
        return mutationFetchJson(
          `/api/taxonomy/subtopics/${params.id}`,
          params.body,
          { method: 'PATCH' },
        );
      }
      return mutationFetchJson('/api/taxonomy/subtopics', params.body);
    },
    onSuccess: (_data, variables) => {
      const action = variables.id ? 'updated' : 'created';
      toast.success(`Subtopic ${action}`);
      setAnnouncement(`Subtopic '${variables.name}' ${action}`);
      setSubtopicDialogOpen(false);
      invalidateAfterMutation(variables.domainId);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save subtopic',
      );
    },
  });

  const subtopicSaving = subtopicSaveMutation.isPending;

  // -----------------------------------------------------------------------
  // Status mutation (deactivate, reactivate, accept, reject)
  // -----------------------------------------------------------------------

  const statusMutation = useMutation({
    mutationFn: (params: {
      type: 'domain' | 'subtopic';
      id: string;
      body: Record<string, unknown>;
      domainId?: string;
      action: 'deactivate' | 'reactivate' | 'accept' | 'reject';
      name?: string;
    }) => {
      const endpoint =
        params.type === 'domain'
          ? `/api/taxonomy/domains/${params.id}`
          : `/api/taxonomy/subtopics/${params.id}`;
      return mutationFetchJson(endpoint, params.body, { method: 'PATCH' });
    },
    onSuccess: (_data, variables) => {
      const entityLabel = variables.type === 'domain' ? 'Domain' : 'Subtopic';

      switch (variables.action) {
        case 'deactivate':
          toast.success(`${entityLabel} deactivated`);
          setAnnouncement(`${entityLabel} '${variables.name}' deactivated`);
          setDeactivateDialogOpen(false);
          setDeactivateTarget(null);
          break;
        case 'reactivate':
          toast.success(`${entityLabel} reactivated`);
          setAnnouncement(`${entityLabel} reactivated`);
          break;
        case 'accept':
          toast.success(`${entityLabel} accepted and activated`);
          setAnnouncement(`Recommended ${variables.type} accepted and activated`);
          break;
        case 'reject':
          toast.success(`Recommendation '${variables.name}' rejected`);
          setAnnouncement(`Recommended ${variables.type} '${variables.name}' rejected`);
          break;
      }

      invalidateAfterMutation(
        variables.type === 'subtopic' ? variables.domainId : undefined,
      );
    },
    onError: (error, variables) => {
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to ${variables.action} ${variables.type}`,
      );
    },
  });

  // -----------------------------------------------------------------------
  // Domain reorder mutation (with optimistic update)
  // -----------------------------------------------------------------------

  const domainReorderMutation = useMutation({
    mutationFn: (params: { items: { id: string; display_order: number }[] }) =>
      mutationFetchJson('/api/taxonomy/reorder', {
        type: 'domain',
        items: params.items,
      }),
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.taxonomy.adminDomains,
      });

      const previousDomains = queryClient.getQueryData<AdminDomain[]>(
        queryKeys.taxonomy.adminDomains,
      );

      if (previousDomains) {
        const updated = previousDomains.map((d) => {
          const update = variables.items.find((i) => i.id === d.id);
          return update ? { ...d, display_order: update.display_order } : d;
        });
        updated.sort((a, b) => a.display_order - b.display_order);
        queryClient.setQueryData(queryKeys.taxonomy.adminDomains, updated);
      }

      return { previousDomains };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousDomains) {
        queryClient.setQueryData(
          queryKeys.taxonomy.adminDomains,
          context.previousDomains,
        );
      }
      toast.error('Failed to reorder domains');
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taxonomy.adminDomains,
      });
      refresh();
    },
  });

  // -----------------------------------------------------------------------
  // Subtopic reorder mutation (with optimistic update)
  // -----------------------------------------------------------------------

  const subtopicReorderMutation = useMutation({
    mutationFn: (params: {
      domainId: string;
      items: { id: string; display_order: number }[];
    }) =>
      mutationFetchJson('/api/taxonomy/reorder', {
        type: 'subtopic',
        domain_id: params.domainId,
        items: params.items,
      }),
    onMutate: async (variables) => {
      const queryKey = queryKeys.taxonomy.adminSubtopics(variables.domainId);
      await queryClient.cancelQueries({ queryKey });

      const previousSubtopics = queryClient.getQueryData<AdminSubtopic[]>(queryKey);

      if (previousSubtopics) {
        const updated = previousSubtopics.map((s) => {
          const update = variables.items.find((i) => i.id === s.id);
          return update ? { ...s, display_order: update.display_order } : s;
        });
        updated.sort((a, b) => a.display_order - b.display_order);
        queryClient.setQueryData(queryKey, updated);
        setSubtopicCacheVersion((v) => v + 1);
      }

      return { previousSubtopics, domainId: variables.domainId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousSubtopics) {
        queryClient.setQueryData(
          queryKeys.taxonomy.adminSubtopics(context.domainId),
          context.previousSubtopics,
        );
        setSubtopicCacheVersion((v) => v + 1);
      }
      toast.error('Failed to reorder subtopics');
    },
    onSettled: (_data, _err, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.taxonomy.adminSubtopics(variables.domainId),
      });
      setSubtopicCacheVersion((v) => v + 1);
      refresh();
    },
  });

  // -----------------------------------------------------------------------
  // Domain CRUD handlers
  // -----------------------------------------------------------------------

  function openAddDomain() {
    setEditingDomain(null);
    setDomainName('');
    setDomainColour('');
    setDomainOrder('');
    setDomainKeySignal('');
    setDomainDialogOpen(true);
  }

  function openEditDomain(domain: AdminDomain) {
    setEditingDomain(domain);
    setDomainName(domain.name);
    setDomainColour(domain.colour ?? '');
    setDomainOrder(String(domain.display_order));
    setDomainKeySignal(domain.key_signal ?? '');
    setDomainDialogOpen(true);
  }

  async function handleDomainSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainName.trim()) return;

    if (editingDomain) {
      const body: Record<string, unknown> = {};
      if (domainName.trim() !== editingDomain.name) body.name = domainName.trim();
      if ((domainColour.trim() || null) !== editingDomain.colour) {
        body.colour = domainColour.trim() || null;
      }
      const orderVal = parseInt(domainOrder, 10);
      if (!isNaN(orderVal) && orderVal !== editingDomain.display_order) {
        body.display_order = orderVal;
      }
      if ((domainKeySignal.trim() || null) !== editingDomain.key_signal) {
        body.key_signal = domainKeySignal.trim() || null;
      }

      if (Object.keys(body).length === 0) {
        setDomainDialogOpen(false);
        return;
      }

      await domainSaveMutation.mutateAsync({
        id: editingDomain.id,
        body,
        name: domainName.trim(),
      });
    } else {
      const body: Record<string, unknown> = { name: domainName.trim() };
      if (domainColour.trim()) body.colour = domainColour.trim();
      const orderVal = parseInt(domainOrder, 10);
      if (!isNaN(orderVal)) body.display_order = orderVal;
      if (domainKeySignal.trim()) body.key_signal = domainKeySignal.trim();

      await domainSaveMutation.mutateAsync({ body, name: domainName.trim() });
    }
  }

  // -----------------------------------------------------------------------
  // Subtopic CRUD handlers
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

    if (editingSubtopic) {
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

      await subtopicSaveMutation.mutateAsync({
        id: editingSubtopic.id,
        domainId: subtopicDomainId,
        body,
        name: subtopicName.trim(),
      });
    } else {
      const body: Record<string, unknown> = {
        domain_id: subtopicDomainId,
        name: subtopicName.trim(),
      };
      const orderVal = parseInt(subtopicOrder, 10);
      if (!isNaN(orderVal)) body.display_order = orderVal;

      await subtopicSaveMutation.mutateAsync({
        domainId: subtopicDomainId,
        body,
        name: subtopicName.trim(),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Activation / deactivation handlers
  // -----------------------------------------------------------------------

  function confirmDeactivate(type: 'domain' | 'subtopic', id: string, name: string) {
    setDeactivateTarget({ type, id, name });
    setDeactivateDialogOpen(true);
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return;

    const { type, id, name } = deactivateTarget;

    // For subtopics, find which domain they belong to
    let domainId: string | undefined;
    if (type === 'subtopic') {
      domainId = Array.from(subtopicsByDomain.entries()).find(
        ([, subs]) => subs.some((s) => s.id === id),
      )?.[0];
    }

    await statusMutation.mutateAsync({
      type,
      id,
      body: { is_active: false },
      domainId,
      action: 'deactivate',
      name,
    });
  }

  async function handleReactivate(
    type: 'domain' | 'subtopic',
    id: string,
    domainId?: string,
  ) {
    await statusMutation.mutateAsync({
      type,
      id,
      body: { is_active: true },
      domainId,
      action: 'reactivate',
    });
  }

  // -----------------------------------------------------------------------
  // Recommended-to-accepted workflow handlers
  // -----------------------------------------------------------------------

  async function handleAcceptRecommended(
    type: 'domain' | 'subtopic',
    id: string,
    domainId?: string,
  ) {
    await statusMutation.mutateAsync({
      type,
      id,
      body: {
        is_active: true,
        accepted_at: new Date().toISOString(),
      },
      domainId,
      action: 'accept',
    });
  }

  async function handleRejectRecommended(
    type: 'domain' | 'subtopic',
    id: string,
    name: string,
    domainId?: string,
  ) {
    await statusMutation.mutateAsync({
      type,
      id,
      body: { is_active: false },
      domainId,
      action: 'reject',
      name,
    });
  }

  // -----------------------------------------------------------------------
  // Reordering handlers
  // -----------------------------------------------------------------------

  async function handleMoveDomain(domainId: string, direction: 'up' | 'down') {
    const idx = domains.findIndex((d) => d.id === domainId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= domains.length) return;

    const current = domains[idx];
    const swap = domains[swapIdx];

    await domainReorderMutation.mutateAsync({
      items: [
        { id: current.id, display_order: swap.display_order },
        { id: swap.id, display_order: current.display_order },
      ],
    });
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

    await subtopicReorderMutation.mutateAsync({
      domainId,
      items: [
        { id: current.id, display_order: swap.display_order },
        { id: swap.id, display_order: current.display_order },
      ],
    });
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
    domainKeySignal,
    setDomainKeySignal,
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
    handleAcceptRecommended,
    handleRejectRecommended,
    handleMoveDomain,
    handleMoveSubtopic,
  };
}
