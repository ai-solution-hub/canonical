'use client';

import { isFeatureEnabled, CLIENT_CONFIG } from '@/lib/client-config';
import { getLayerLabel } from '@/lib/validation/layer-schemas';
import { Badge } from '@/components/ui/badge';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

export interface ContentLayerSelectorProps {
  item: ItemData;
  canEdit: boolean;
  handleLayerChange: (newLayer: string | null) => Promise<void>;
}

export function ContentLayerSelector({
  item,
  canEdit,
  handleLayerChange,
}: ContentLayerSelectorProps) {
  if (!isFeatureEnabled('content_layers')) return null;

  // Editable layer selector (for editors)
  if (canEdit) {
    return (
      <section className="mb-6 border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Content Layer
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleLayerChange(null)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !item.metadata?.layer
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted text-foreground hover:bg-accent'
            }`}
          >
            No layer
          </button>
          {CLIENT_CONFIG.layer_vocabulary.map((layer) => {
            const isActive = item.metadata?.layer === layer.key;
            return (
              <button
                key={layer.key}
                type="button"
                onClick={() => handleLayerChange(layer.key)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  isActive
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted text-foreground hover:bg-accent'
                }`}
              >
                {layer.label}
              </button>
            );
          })}
        </div>
        {!!item.metadata?.layer && (
          <p className="mt-1 text-xs text-muted-foreground">
            {CLIENT_CONFIG.layer_vocabulary.find(
              (l) => l.key === (item.metadata?.layer as string),
            )?.description}
          </p>
        )}
      </section>
    );
  }

  // Read-only layer badge (for viewers)
  if (!item.metadata?.layer) return null;

  return (
    <section className="mb-6 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Content Layer
      </h3>
      <Badge variant="outline" className="text-xs border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
        {getLayerLabel(item.metadata.layer as string)}
      </Badge>
    </section>
  );
}
