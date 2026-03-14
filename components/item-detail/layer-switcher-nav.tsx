'use client';

import Link from 'next/link';
import { isFeatureEnabled } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
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
  if (!isFeatureEnabled('content_layers') || topicLayers.length <= 1) {
    return null;
  }

  return (
    <nav aria-label="Content layers" className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground mr-1">Layers:</span>
        {topicLayers.map((layerItem) => {
          const isCurrent = layerItem.id === currentItemId;
          const label = layerItem.layer
            ? getLayerLabel(layerItem.layer)
            : layerItem.title ?? 'Untitled';
          return isCurrent ? (
            <Badge
              key={layerItem.id}
              variant="default"
              className="text-xs"
            >
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
