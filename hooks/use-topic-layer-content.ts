'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
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
// Pure function -- exported for testing
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
 * Migrated from useState+useEffect to TanStack Query. Uses `enabled` option
 * for conditional fetching when there are sibling items to load.
 */
export function useTopicLayerContent(
  topicLayers: Array<{
    id: string;
    title: string | null;
    layer: string | null;
    content_type: string | null;
  }>,
  currentItemId: string,
) {
  const siblingIds = useMemo(
    () =>
      topicLayers
        .filter((l) => l.id !== currentItemId)
        .map((l) => l.id),
    [topicLayers, currentItemId],
  );

  const { data: layerContent = {}, isLoading } = useQuery({
    queryKey: queryKeys.topicLayers.content(siblingIds),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('content_items')
        .select(
          'id, title, brief, detail, content, content_type, metadata, layer',
        )
        .in('id', siblingIds);

      if (error) throw error;

      if (!data) return {};

      const mapped: LayerItem[] = data.map((row) => ({
        id: row.id,
        layer:
          ((row as Record<string, unknown>).layer as string) ?? '',
        title: row.title ?? '',
        brief: row.brief ?? null,
        detail: row.detail ?? null,
        content: row.content ?? null,
        content_type: row.content_type ?? '',
        metadata: row.metadata as Record<string, unknown> | null,
      }));

      return groupLayerContent(mapped);
    },
    enabled: topicLayers.length > 1 && siblingIds.length > 0,
  });

  return { layerContent, isLoading };
}
