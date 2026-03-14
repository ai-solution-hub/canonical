'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LayerItem {
  id: string;
  layer: string;
  title: string;
  brief: string | null;
  detail: string | null;
  content: string | null;
  content_type: string;
  metadata: Record<string, unknown> | null;
}

export interface LayerContentMap {
  [layerKey: string]: LayerItem;
}

// ---------------------------------------------------------------------------
// Pure function — exported for testing
// ---------------------------------------------------------------------------

/**
 * Group an array of layer items into a map keyed by their layer value.
 * Items without a layer are skipped.
 */
export function groupLayerContent(items: LayerItem[]): LayerContentMap {
  return items.reduce<LayerContentMap>((acc, item) => {
    if (item.layer) acc[item.layer] = item;
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetches content (title, brief, detail, content, content_type, metadata)
 * for sibling layer items that share the same topic_id.
 *
 * Uses Supabase client directly (same pattern as useQAProvenance).
 */
export function useTopicLayerContent(
  topicLayers: Array<{ id: string; title: string | null; layer: string | null; content_type: string | null }>,
  currentItemId: string,
) {
  const [layerContent, setLayerContent] = useState<LayerContentMap>({});
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (topicLayers.length <= 1) return;

    const siblingIds = topicLayers
      .filter((l) => l.id !== currentItemId)
      .map((l) => l.id);

    if (siblingIds.length === 0) return;

    setIsLoading(true);

    const fetchSiblings = async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('content_items')
          .select('id, title, brief, detail, content, content_type, metadata')
          .in('id', siblingIds);

        if (error) {
          console.error('Failed to fetch layer content:', error);
          return;
        }

        if (data) {
          const mapped: LayerItem[] = data.map((row) => ({
            id: row.id,
            layer: ((row.metadata as Record<string, unknown> | null)?.layer as string) ?? '',
            title: row.title ?? '',
            brief: row.brief ?? null,
            detail: row.detail ?? null,
            content: row.content ?? null,
            content_type: row.content_type ?? '',
            metadata: row.metadata as Record<string, unknown> | null,
          }));
          setLayerContent(groupLayerContent(mapped));
        }
      } catch (err) {
        console.error('Failed to fetch layer content:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSiblings();
  }, [topicLayers, currentItemId]);

  return { layerContent, isLoading };
}
