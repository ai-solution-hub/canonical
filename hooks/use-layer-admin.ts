'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, mutationFetchJson } from '@/lib/query/fetchers';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminLayer {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface UseLayerAdminParams {
  refresh: () => void;
}

export interface UseLayerAdminReturn {
  layers: AdminLayer[];
  loading: boolean;

  // Dialog state
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editingLayer: AdminLayer | null;

  // Form fields
  layerKey: string;
  setLayerKey: (value: string) => void;
  layerLabel: string;
  setLayerLabel: (value: string) => void;
  layerDescription: string;
  setLayerDescription: (value: string) => void;
  layerOrder: string;
  setLayerOrder: (value: string) => void;
  saving: boolean;

  // Screen reader announcement
  announcement: string;

  // Handlers
  openAddLayer: () => void;
  openEditLayer: (layer: AdminLayer) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleToggleActive: (layer: AdminLayer) => Promise<void>;
  handleDelete: (layer: AdminLayer) => Promise<void>;
  handleMove: (layerId: string, direction: 'up' | 'down') => Promise<void>;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export function generateKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLayerAdmin({
  refresh,
}: UseLayerAdminParams): UseLayerAdminReturn {
  const queryClient = useQueryClient();

  // -----------------------------------------------------------------------
  // UI state (not server state — stays as useState)
  // -----------------------------------------------------------------------

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState<AdminLayer | null>(null);

  const [layerKey, setLayerKey] = useState('');
  const [layerLabel, setLayerLabel] = useState('');
  const [layerDescription, setLayerDescription] = useState('');
  const [layerOrder, setLayerOrder] = useState('');

  const [announcement, setAnnouncement] = useState('');

  // -----------------------------------------------------------------------
  // Data fetching via TanStack Query
  // -----------------------------------------------------------------------

  const {
    data: layers = [],
    isLoading: loading,
  } = useQuery({
    queryKey: queryKeys.layers.list,
    queryFn: () => fetchJson<AdminLayer[]>('/api/layers'),
  });

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  const submitMutation = useMutation({
    mutationFn: async (args: {
      editingLayer: AdminLayer | null;
      resolvedKey: string;
      label: string;
      description: string;
      order: string;
    }) => {
      if (args.editingLayer) {
        // Update (key is not updatable)
        const body: Record<string, unknown> = {};
        if (args.label.trim() !== args.editingLayer.label) body.label = args.label.trim();
        if ((args.description.trim() || null) !== args.editingLayer.description) {
          body.description = args.description.trim() || null;
        }
        const orderVal = parseInt(args.order, 10);
        if (!isNaN(orderVal) && orderVal !== args.editingLayer.display_order) {
          body.display_order = orderVal;
        }

        if (Object.keys(body).length === 0) {
          return { action: 'no-change' as const };
        }

        await mutationFetchJson(
          `/api/layers/${args.editingLayer.id}`,
          body,
          { method: 'PATCH' },
        );
        return { action: 'update' as const, label: args.label.trim() };
      } else {
        // Create
        const body: Record<string, unknown> = {
          key: args.resolvedKey,
          label: args.label.trim(),
        };
        if (args.description.trim()) body.description = args.description.trim();
        const orderVal = parseInt(args.order, 10);
        if (!isNaN(orderVal)) body.display_order = orderVal;

        await mutationFetchJson('/api/layers', body);
        return { action: 'create' as const, label: args.label.trim() };
      }
    },
    onSuccess: (result) => {
      if (result.action === 'no-change') {
        setDialogOpen(false);
        return;
      }
      if (result.action === 'update') {
        toast.success('Layer updated');
        setAnnouncement(`Layer '${result.label}' updated`);
      } else {
        toast.success('Layer created');
        setAnnouncement(`Layer '${result.label}' created`);
      }
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
      refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save layer');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (layer: AdminLayer) => {
      const newActive = !layer.is_active;
      await mutationFetchJson(
        `/api/layers/${layer.id}`,
        { is_active: newActive },
        { method: 'PATCH' },
      );
      return { layer, newActive };
    },
    onSuccess: ({ layer, newActive }) => {
      toast.success(`Layer ${newActive ? 'reactivated' : 'deactivated'}`);
      setAnnouncement(`Layer '${layer.label}' ${newActive ? 'reactivated' : 'deactivated'}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
      refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update layer');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (layer: AdminLayer) => {
      await mutationFetchJson(
        `/api/layers/${layer.id}`,
        null,
        { method: 'DELETE' },
      );
      return layer;
    },
    onSuccess: (layer) => {
      toast.success('Layer deleted');
      setAnnouncement(`Layer '${layer.label}' deleted`);
      queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
      refresh();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete layer');
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (args: {
      layerId: string;
      direction: 'up' | 'down';
      items: { id: string; display_order: number }[];
    }) => {
      await mutationFetchJson(
        '/api/layers/reorder',
        { layers: args.items },
        { method: 'PUT' },
      );
    },
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.layers.list });
      const previous = queryClient.getQueryData<AdminLayer[]>(queryKeys.layers.list);

      queryClient.setQueryData<AdminLayer[]>(queryKeys.layers.list, (old) => {
        if (!old) return old;
        const idx = old.findIndex((l) => l.id === args.layerId);
        if (idx === -1) return old;
        const swapIdx = args.direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= old.length) return old;

        const updated = [...old];
        const current = updated[idx];
        const swap = updated[swapIdx];
        updated[idx] = { ...current, display_order: swap.display_order };
        updated[swapIdx] = { ...swap, display_order: current.display_order };
        updated.sort((a, b) => a.display_order - b.display_order);
        return updated;
      });

      return { previous };
    },
    onError: (_err, _args, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.layers.list, context.previous);
      }
      toast.error('Failed to reorder layers');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.layers.all });
      refresh();
    },
  });

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const openAddLayer = useCallback(() => {
    setEditingLayer(null);
    setLayerKey('');
    setLayerLabel('');
    setLayerDescription('');
    setLayerOrder('');
    setDialogOpen(true);
  }, []);

  const openEditLayer = useCallback((layer: AdminLayer) => {
    setEditingLayer(layer);
    setLayerKey(layer.key);
    setLayerLabel(layer.label);
    setLayerDescription(layer.description ?? '');
    setLayerOrder(String(layer.display_order));
    setDialogOpen(true);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!layerLabel.trim()) return;

    const resolvedKey = layerKey.trim() || generateKey(layerLabel);
    if (!resolvedKey) {
      toast.error('A valid key is required');
      return;
    }

    await submitMutation.mutateAsync({
      editingLayer,
      resolvedKey,
      label: layerLabel,
      description: layerDescription,
      order: layerOrder,
    });
  }, [layerLabel, layerKey, layerDescription, layerOrder, editingLayer, submitMutation]);

  const handleToggleActive = useCallback(async (layer: AdminLayer) => {
    await toggleActiveMutation.mutateAsync(layer);
  }, [toggleActiveMutation]);

  const handleDelete = useCallback(async (layer: AdminLayer) => {
    await deleteMutation.mutateAsync(layer);
  }, [deleteMutation]);

  const handleMove = useCallback(async (layerId: string, direction: 'up' | 'down') => {
    const currentLayers = queryClient.getQueryData<AdminLayer[]>(queryKeys.layers.list) ?? [];
    const idx = currentLayers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= currentLayers.length) return;

    const current = currentLayers[idx];
    const swap = currentLayers[swapIdx];

    const items = [
      { id: current.id, display_order: swap.display_order },
      { id: swap.id, display_order: current.display_order },
    ];

    await moveMutation.mutateAsync({ layerId, direction, items });
  }, [moveMutation, queryClient]);

  return {
    layers,
    loading,
    dialogOpen,
    setDialogOpen,
    editingLayer,
    layerKey,
    setLayerKey,
    layerLabel,
    setLayerLabel,
    layerDescription,
    setLayerDescription,
    layerOrder,
    setLayerOrder,
    saving: submitMutation.isPending,
    announcement,
    openAddLayer,
    openEditLayer,
    handleSubmit,
    handleToggleActive,
    handleDelete,
    handleMove,
  };
}
