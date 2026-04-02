'use client';

import Link from 'next/link';
import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { Badge } from '@/components/ui/badge';

export interface TopicLayerItem {
  id: string;
  title: string | null;
  layer: string | null;
}

export interface LayerSwitcherNavProps {
  currentItemId: string;
  topicLayers: TopicLayerItem[];
}

/**
 * Horizontal navigation showing linked items that share the same topic_id.
 * Only renders when the content_layers feature is enabled and more than one
 * layer exists.
 */
export function LayerSwitcherNav({
  currentItemId,
  topicLayers,
}: LayerSwitcherNavProps) {
  const { getLayerLabel } = useLayerVocabulary();

  // Deduplicate by layer key (belt-and-braces — RPC should already return
  // distinct layers, but guard against duplicates at the UI level too)
  const uniqueLayers = topicLayers.filter(
    (item, index, arr) =>
      item.layer != null &&
      arr.findIndex((other) => other.layer === item.layer) === index,
  );

  if (!isFeatureEnabled('content_layers') || uniqueLayers.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Content depth" className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">
          Depth:
        </span>
        {uniqueLayers.map((layerItem) => {
          const isCurrent = layerItem.id === currentItemId;
          const label = layerItem.layer
            ? getLayerLabel(layerItem.layer)
            : (layerItem.title ?? 'Untitled');
          return isCurrent ? (
            <Badge key={layerItem.id} variant="default" className="text-xs">
              {label}
            </Badge>
          ) : (
            <Link key={layerItem.id} href={`/item/${layerItem.id}`}>
              <Badge
                variant="outline"
                className="text-xs cursor-pointer hover:bg-accent transition-colors"
              >
                {label}
              </Badge>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
