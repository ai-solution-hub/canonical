'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isFeatureEnabled } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
import { toast } from 'sonner';

export interface UseQAProvenanceParams {
  itemId: string;
  isQAPair: boolean;
  metadata: Record<string, unknown> | null;
  onMetadataUpdate: (updater: (prevMetadata: Record<string, unknown> | null) => Record<string, unknown> | null) => void;
}

export interface UseQAProvenanceReturn {
  usedInWorkspaces: Array<{ id: string; name: string; type: string }>;
  relatedQA: Array<{ id: string; title: string | null }>;
  topicLayers: Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>;
  handleLayerChange: (newLayer: string | null) => Promise<void>;
}

export function useQAProvenance({
  itemId,
  isQAPair,
  metadata,
  onMetadataUpdate,
}: UseQAProvenanceParams): UseQAProvenanceReturn {
  const [usedInWorkspaces, setUsedInWorkspaces] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [relatedQA, setRelatedQA] = useState<Array<{ id: string; title: string | null }>>([]);
  const [topicLayers, setTopicLayers] = useState<
    Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>
  >([]);

  // Fetch workspaces (bids) using this Q&A pair
  useEffect(() => {
    if (!isQAPair) return;
    const fetchWorkspaces = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_item_workspaces')
        .select('workspace_id, workspaces:workspace_id(id, name, type)')
        .eq('content_item_id', itemId);
      if (data) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const workspaces = (data as any[])
          .map((d) => d.workspaces)
          .filter(Boolean)
          .filter((w) => w.type === 'bid');
        /* eslint-enable @typescript-eslint/no-explicit-any */
        setUsedInWorkspaces(workspaces as Array<{ id: string; name: string; type: string }>);
      }
    };
    fetchWorkspaces();
  }, [itemId, isQAPair]);

  // Fetch related Q&A pairs from the same source document
  useEffect(() => {
    if (!isQAPair) return;
    const sourceFile = (metadata as Record<string, unknown> | null)?.source_file as string | undefined;
    if (!sourceFile) return;
    const fetchRelated = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('content_items')
        .select('id, title')
        .eq('content_type', 'q_a_pair')
        .eq('metadata->>source_file', sourceFile)
        .neq('id', itemId)
        .order('title')
        .limit(10);
      if (data) setRelatedQA(data as Array<{ id: string; title: string | null }>);
    };
    fetchRelated();
  }, [itemId, metadata, isQAPair]);

  // Fetch topic layers (items sharing the same topic_id)
  useEffect(() => {
    if (!isFeatureEnabled('content_layers')) return;
    const fetchLayers = async () => {
      try {
        const res = await fetch(`/api/items/${itemId}/layers`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.layers?.length > 0) {
          setTopicLayers(
            data.layers as Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>,
          );
        }
      } catch {
        // Non-critical — fail silently
      }
    };
    fetchLayers();
  }, [itemId]);

  // Inline layer editing handler
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
        const res = await fetch(`/api/items/${itemId}/metadata`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layer: newLayer }),
        });
        if (!res.ok) throw new Error();
        toast.success(newLayer ? `Layer set to ${getLayerLabel(newLayer)}` : 'Layer cleared');
      } catch (err) {
        console.error('Failed to update layer:', err);
        // Rollback
        onMetadataUpdate(() => prevMetadata);
        toast.error('Failed to update layer');
      }
    },
    [itemId, metadata, onMetadataUpdate],
  );

  return {
    usedInWorkspaces,
    relatedQA,
    topicLayers,
    handleLayerChange,
  };
}
