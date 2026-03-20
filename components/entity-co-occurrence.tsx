'use client';

import { useState, useEffect, useCallback } from 'react';
import { Network, Loader2 } from 'lucide-react';
import { FilterSection } from '@/components/filter-section';

/** Entity type to semantic token mapping for badges */
const ENTITY_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  organisation: {
    bg: 'bg-entity-organisation-bg',
    text: 'text-entity-organisation-text',
  },
  certification: {
    bg: 'bg-entity-certification-bg',
    text: 'text-entity-certification-text',
  },
  regulation: {
    bg: 'bg-entity-regulation-bg',
    text: 'text-entity-regulation-text',
  },
  framework: {
    bg: 'bg-entity-framework-bg',
    text: 'text-entity-framework-text',
  },
  capability: {
    bg: 'bg-entity-capability-bg',
    text: 'text-entity-capability-text',
  },
  person: {
    bg: 'bg-entity-person-bg',
    text: 'text-entity-person-text',
  },
  technology: {
    bg: 'bg-entity-technology-bg',
    text: 'text-entity-technology-text',
  },
  project: {
    bg: 'bg-entity-project-bg',
    text: 'text-entity-project-text',
  },
  sector: {
    bg: 'bg-entity-sector-bg',
    text: 'text-entity-sector-text',
  },
  product: {
    bg: 'bg-entity-product-bg',
    text: 'text-entity-product-text',
  },
};

/** Get style classes for an entity type, with a neutral fallback */
function getEntityStyle(entityType: string): { bg: string; text: string } {
  return ENTITY_TYPE_STYLES[entityType] ?? {
    bg: 'bg-muted',
    text: 'text-foreground',
  };
}

/** Format entity type labels for display */
function formatEntityType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export interface CoOccurrencePair {
  entity_a: string;
  type_a: string;
  entity_b: string;
  type_b: string;
  shared_count: number;
}

interface EntityCoOccurrenceProps {
  /** Called when user clicks an entity name to filter the browse page */
  onEntityClick?: (entityName: string) => void;
  /** Maximum pairs to show (default 10) */
  maxPairs?: number;
  /** Whether to show the section (default true) */
  show?: boolean;
  /** Start collapsed (default true) */
  defaultOpen?: boolean;
}

/**
 * Displays entities that frequently co-occur in the same content items.
 * Each entity is clickable to trigger a browse page filter.
 */
export function EntityCoOccurrence({
  onEntityClick,
  maxPairs = 10,
  show = true,
  defaultOpen = false,
}: EntityCoOccurrenceProps) {
  const [pairs, setPairs] = useState<CoOccurrencePair[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCoOccurrence = useCallback(async () => {
    if (hasLoaded) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/entities/co-occurrence?limit=${maxPairs}&min=2`,
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setPairs(data.pairs ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load';
      setError(message);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }, [hasLoaded, maxPairs]);

  // Fetch on mount if shown
  useEffect(() => {
    if (show && !hasLoaded) {
      fetchCoOccurrence();
    }
  }, [show, hasLoaded, fetchCoOccurrence]);

  if (!show) return null;

  return (
    <FilterSection title="Entity Co-occurrence" defaultOpen={defaultOpen}>
      {isLoading && (
        <div className="flex items-center justify-center py-4" role="status" aria-label="Loading co-occurrence data">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading entity co-occurrence data</span>
        </div>
      )}

      {error && (
        <p className="text-xs text-muted-foreground py-2">
          Could not load co-occurrence data
        </p>
      )}

      {!isLoading && !error && pairs.length === 0 && hasLoaded && (
        <p className="text-xs text-muted-foreground py-2">
          No frequently co-occurring entities found
        </p>
      )}

      {!isLoading && pairs.length > 0 && (
        <div className="space-y-1.5" role="list" aria-label="Co-occurring entity pairs">
          {pairs.map((pair) => {
            const styleA = getEntityStyle(pair.type_a);
            const styleB = getEntityStyle(pair.type_b);

            return (
              <div
                key={`${pair.entity_a}--${pair.entity_b}`}
                role="listitem"
                className="flex items-center gap-1.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onEntityClick?.(pair.entity_a)}
                  className={`inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 transition-colors hover:border-border ${styleA.bg} ${styleA.text}`}
                  title={`Filter by ${pair.entity_a} (${formatEntityType(pair.type_a)})`}
                  aria-label={`Filter by entity: ${pair.entity_a}`}
                >
                  <span className="max-w-[120px] truncate">{pair.entity_a}</span>
                </button>

                <Network className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />

                <button
                  type="button"
                  onClick={() => onEntityClick?.(pair.entity_b)}
                  className={`inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 transition-colors hover:border-border ${styleB.bg} ${styleB.text}`}
                  title={`Filter by ${pair.entity_b} (${formatEntityType(pair.type_b)})`}
                  aria-label={`Filter by entity: ${pair.entity_b}`}
                >
                  <span className="max-w-[120px] truncate">{pair.entity_b}</span>
                </button>

                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {pair.shared_count}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-1.5 text-xs text-muted-foreground">
        Entities that frequently appear together in content
      </p>
    </FilterSection>
  );
}
