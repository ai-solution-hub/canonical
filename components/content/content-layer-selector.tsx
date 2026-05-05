'use client';

import { isFeatureEnabled } from '@/lib/client-config';
import { useLayerVocabulary } from '@/contexts/layer-vocabulary-context';
import { Badge } from '@/components/ui/badge';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

/** @public */
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
  const { layers, getLayerLabel, getLayerDescription } = useLayerVocabulary();

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
            aria-pressed={!item.layer}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              !item.layer
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-muted text-foreground hover:bg-accent'
            }`}
          >
            No layer
          </button>
          {layers.map((layer) => {
            const isActive = item.layer === layer.key;
            return (
              <button
                key={layer.key}
                type="button"
                onClick={() => handleLayerChange(layer.key)}
                aria-pressed={isActive}
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
        {!!item.layer && (
          <p className="mt-1 text-xs text-muted-foreground">
            {getLayerDescription(item.layer)}
          </p>
        )}
      </section>
    );
  }

  // Read-only layer badge (for viewers)
  if (!item.layer) return null;

  return (
    <section className="mb-6 border-t border-border pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Content Layer
      </h3>
      <Badge
        variant="outline"
        className="text-xs border-confidence-needs-sme-border text-confidence-needs-sme"
      >
        {getLayerLabel(item.layer)}
      </Badge>
    </section>
  );
}
