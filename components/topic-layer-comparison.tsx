'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink } from 'lucide-react';
import { getLayerLabel, getOrderedLayers } from '@/lib/validation/layer-schemas';
import { cn } from '@/lib/utils';
import type { LayerItem } from '@/hooks/use-topic-layer-content';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TopicLayerComparisonProps {
  currentItem: LayerItem;
  layerContent: Record<string, LayerItem>;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Tabbed comparison view showing layer content side by side.
 * Users can toggle between layers (e.g. Sales Brief vs Bid Detail)
 * for the same topic without navigating away.
 */
export function TopicLayerComparison({
  currentItem,
  layerContent,
  isLoading,
}: TopicLayerComparisonProps) {
  // All layers: current item + siblings
  const allLayers: Record<string, LayerItem> = {
    [currentItem.layer]: currentItem,
    ...layerContent,
  };

  // Sort by configured display order
  const orderedLayers = getOrderedLayers();
  const layerOrder: string[] = orderedLayers.map((l) => l.key);

  const layerKeys = Object.keys(allLayers).sort((a, b) => {
    const aIdx = layerOrder.indexOf(a);
    const bIdx = layerOrder.indexOf(b);
    // Unknown layers sort to the end
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  const [activeLayer, setActiveLayer] = useState(currentItem.layer);
  const activeItem = allLayers[activeLayer];

  if (layerKeys.length <= 1) return null;

  return (
    <section
      aria-label="Topic layer comparison"
      className="mb-4 rounded-lg border border-border bg-card"
    >
      {/* Layer tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">
          Compare layers:
        </span>
        {layerKeys.map((key) => (
          <button
            key={key}
            onClick={() => setActiveLayer(key)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              activeLayer === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent',
            )}
            aria-pressed={activeLayer === key}
          >
            {getLayerLabel(key)}
            {key === currentItem.layer && ' (current)'}
          </button>
        ))}
      </div>

      {/* Content preview */}
      {isLoading ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : activeItem ? (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{activeItem.title}</h4>
            <Badge variant="outline" className="text-[10px]">
              {getLayerLabel(activeItem.layer)}
            </Badge>
          </div>

          {activeItem.brief && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Brief
              </span>
              <p className="mt-0.5 line-clamp-4 text-sm text-foreground/80">
                {activeItem.brief}
              </p>
            </div>
          )}

          {activeItem.detail && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Detail
              </span>
              <p className="mt-0.5 line-clamp-4 text-sm text-foreground/80">
                {activeItem.detail}
              </p>
            </div>
          )}

          {!activeItem.brief && !activeItem.detail && activeItem.content && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Content
              </span>
              <p className="mt-0.5 line-clamp-4 text-sm text-foreground/80">
                {activeItem.content}
              </p>
            </div>
          )}

          {activeItem.id !== currentItem.id && (
            <div className="pt-1">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
              >
                <Link href={`/item/${activeItem.id}`}>
                  Open full item
                  <ExternalLink className="size-3" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
