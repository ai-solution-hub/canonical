'use client';

import { useState, useEffect, useCallback } from 'react';
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

function generateKey(label: string): string {
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
  const [layers, setLayers] = useState<AdminLayer[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLayer, setEditingLayer] = useState<AdminLayer | null>(null);

  const [layerKey, setLayerKey] = useState('');
  const [layerLabel, setLayerLabel] = useState('');
  const [layerDescription, setLayerDescription] = useState('');
  const [layerOrder, setLayerOrder] = useState('');
  const [saving, setSaving] = useState(false);

  const [announcement, setAnnouncement] = useState('');

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchLayers = useCallback(async () => {
    try {
      const res = await fetch('/api/layers');
      if (!res.ok) throw new Error('Failed to load layers');
      const data: AdminLayer[] = await res.json();
      setLayers(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load layers',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLayers();
  }, [fetchLayers]);

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  function openAddLayer() {
    setEditingLayer(null);
    setLayerKey('');
    setLayerLabel('');
    setLayerDescription('');
    setLayerOrder('');
    setDialogOpen(true);
  }

  function openEditLayer(layer: AdminLayer) {
    setEditingLayer(layer);
    setLayerKey(layer.key);
    setLayerLabel(layer.label);
    setLayerDescription(layer.description ?? '');
    setLayerOrder(String(layer.display_order));
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!layerLabel.trim()) return;

    const resolvedKey = layerKey.trim() || generateKey(layerLabel);
    if (!resolvedKey) {
      toast.error('A valid key is required');
      return;
    }

    setSaving(true);

    try {
      if (editingLayer) {
        // Update (key is not updatable)
        const body: Record<string, unknown> = {};
        if (layerLabel.trim() !== editingLayer.label) body.label = layerLabel.trim();
        if ((layerDescription.trim() || null) !== editingLayer.description) {
          body.description = layerDescription.trim() || null;
        }
        const orderVal = parseInt(layerOrder, 10);
        if (!isNaN(orderVal) && orderVal !== editingLayer.display_order) {
          body.display_order = orderVal;
        }

        if (Object.keys(body).length === 0) {
          setDialogOpen(false);
          return;
        }

        const res = await fetch(`/api/layers/${editingLayer.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to update layer');
        }

        toast.success('Layer updated');
        setAnnouncement(`Layer '${layerLabel.trim()}' updated`);
      } else {
        // Create
        const body: Record<string, unknown> = {
          key: resolvedKey,
          label: layerLabel.trim(),
        };
        if (layerDescription.trim()) body.description = layerDescription.trim();
        const orderVal = parseInt(layerOrder, 10);
        if (!isNaN(orderVal)) body.display_order = orderVal;

        const res = await fetch('/api/layers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to create layer');
        }

        toast.success('Layer created');
        setAnnouncement(`Layer '${layerLabel.trim()}' created`);
      }

      setDialogOpen(false);
      fetchLayers();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save layer');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(layer: AdminLayer) {
    const newActive = !layer.is_active;
    try {
      const res = await fetch(`/api/layers/${layer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${newActive ? 'reactivate' : 'deactivate'} layer`);
      }

      toast.success(`Layer ${newActive ? 'reactivated' : 'deactivated'}`);
      setAnnouncement(`Layer '${layer.label}' ${newActive ? 'reactivated' : 'deactivated'}`);
      fetchLayers();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update layer');
    }
  }

  async function handleDelete(layer: AdminLayer) {
    try {
      const res = await fetch(`/api/layers/${layer.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete layer');
      }

      toast.success('Layer deleted');
      setAnnouncement(`Layer '${layer.label}' deleted`);
      fetchLayers();
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete layer');
    }
  }

  // -----------------------------------------------------------------------
  // Reordering
  // -----------------------------------------------------------------------

  async function handleMove(layerId: string, direction: 'up' | 'down') {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= layers.length) return;

    const current = layers[idx];
    const swap = layers[swapIdx];

    const items = [
      { id: current.id, display_order: swap.display_order },
      { id: swap.id, display_order: current.display_order },
    ];

    // Optimistic update
    const updated = [...layers];
    updated[idx] = { ...current, display_order: swap.display_order };
    updated[swapIdx] = { ...swap, display_order: current.display_order };
    updated.sort((a, b) => a.display_order - b.display_order);
    setLayers(updated);

    try {
      const res = await fetch('/api/layers/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: items }),
      });

      if (!res.ok) {
        throw new Error('Failed to reorder');
      }
      refresh();
    } catch (err) {
      console.error('Failed to reorder layers:', err);
      toast.error('Failed to reorder layers');
      fetchLayers(); // Rollback
    }
  }

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
    saving,
    announcement,
    openAddLayer,
    openEditLayer,
    handleSubmit,
    handleToggleActive,
    handleDelete,
    handleMove,
  };
}
