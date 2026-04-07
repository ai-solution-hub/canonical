'use client';

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { isFeatureEnabled } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';

export interface UseQAProvenanceParams {
  itemId: string;
  isQAPair: boolean;
  metadata: Record<string, unknown> | null;
  /** Direct source_file column value (preferred over metadata extraction) */
  sourceFile?: string | null;
  onMetadataUpdate: (
    updater: (
      prevMetadata: Record<string, unknown> | null,
    ) => Record<string, unknown> | null,
  ) => void;
}

export interface UseQAProvenanceReturn {
  usedInWorkspaces: Array<{ id: string; name: string; type: string }>;
  relatedQA: Array<{ id: string; title: string | null }>;
  topicLayers: Array<{
    id: string;
    title: string | null;
    layer: string | null;
    content_type: string | null;
  }>;
  handleLayerChange: (newLayer: string | null) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types for Supabase join query
// ---------------------------------------------------------------------------

interface WorkspaceJoinRow {
  workspace_id: string;
  workspaces: { id: string; name: string; type: string } | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useQAProvenance({
  itemId,
  isQAPair,
  metadata,
  sourceFile: sourceFileProp,
  onMetadataUpdate,
}: UseQAProvenanceParams): UseQAProvenanceReturn {
  const queryClient = useQueryClient();

  // Derive sourceFile from prop or metadata fallback
  const sourceFile =
    sourceFileProp ??
    ((metadata as Record<string, unknown> | null)?.source_file as
      | string
      | undefined);

  // -----------------------------------------------------------------------
  // Query 1: Workspaces (bids) using this Q&A pair
  // -----------------------------------------------------------------------
  const workspacesQuery = useQuery({
    queryKey: queryKeys.qaProvenance.workspaces(itemId),
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_item_workspaces')
        .select('workspace_id, workspaces:workspace_id(id, name, type)')
        .eq('content_item_id', itemId);
      if (!data) return [];
      return (data as WorkspaceJoinRow[])
        .map((d) => d.workspaces)
        .filter(
          (w): w is { id: string; name: string; type: string } =>
            w !== null && w.type === 'bid',
        );
    },
    enabled: isQAPair,
    staleTime: 30_000,
  });

  // -----------------------------------------------------------------------
  // Query 2: Related Q&A from the same source document
  // -----------------------------------------------------------------------
  const relatedQuery = useQuery({
    queryKey: queryKeys.qaProvenance.related(itemId, sourceFile ?? ''),
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_items')
        .select('id, title')
        .eq('content_type', 'q_a_pair')
        .eq('source_file', sourceFile!)
        .neq('id', itemId)
        .order('title')
        .limit(10);
      if (!data) return [];
      return data as Array<{ id: string; title: string | null }>;
    },
    enabled: isQAPair && !!sourceFile,
    staleTime: 30_000,
  });

  // -----------------------------------------------------------------------
  // Query 3: Topic layers (feature-gated)
  // -----------------------------------------------------------------------
  const layersQuery = useQuery({
    queryKey: queryKeys.qaProvenance.layers(itemId),
    queryFn: async () => {
      const res = await fetch(`/api/items/${itemId}/layers`);
      if (!res.ok) return [];
      const data = await res.json();
      if (data.layers?.length > 0) {
        return data.layers as Array<{
          id: string;
          title: string | null;
          layer: string | null;
          content_type: string | null;
        }>;
      }
      return [];
    },
    enabled: isFeatureEnabled('content_layers'),
    staleTime: 30_000,
  });

  // -----------------------------------------------------------------------
  // Mutation: Inline layer editing with optimistic update + rollback
  // -----------------------------------------------------------------------
  const layerMutation = useMutation({
    mutationFn: async (newLayer: string | null) => {
      const res = await fetch(`/api/items/${itemId}/metadata`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layer: newLayer }),
      });
      if (!res.ok) throw new Error('Failed to update layer');
      return newLayer;
    },
    onSuccess: (newLayer) => {
      toast.success(
        newLayer ? `Layer set to ${getLayerLabel(newLayer)}` : 'Layer cleared',
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.qaProvenance.layers(itemId),
      });
    },
  });

  const { mutateAsync: layerMutateAsync } = layerMutation;

  // Wrap mutation in a callback that preserves the original optimistic
  // update / rollback contract via onMetadataUpdate
  const handleLayerChange = useCallback(
    async (newLayer: string | null) => {
      const prevMetadata = metadata;

      // Optimistic update
      onMetadataUpdate((prev) => {
        if (newLayer) {
          return { ...prev, layer: newLayer };
        }
        const m = { ...prev };
        delete m?.layer;
        return m;
      });

      try {
        await layerMutateAsync(newLayer);
      } catch (err) {
        console.error('Failed to update layer:', err);
        // Rollback
        onMetadataUpdate(() => prevMetadata);
        toast.error('Failed to update layer');
      }
    },
    [metadata, onMetadataUpdate, layerMutateAsync],
  );

  return {
    usedInWorkspaces: workspacesQuery.data ?? [],
    relatedQA: relatedQuery.data ?? [],
    topicLayers: layersQuery.data ?? [],
    handleLayerChange,
  };
}
