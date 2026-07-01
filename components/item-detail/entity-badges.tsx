'use client';

import { useState, useEffect, useCallback } from 'react';
import { FileX, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { captureClientException } from '@/lib/client-telemetry';

interface EntityMention {
  id: string;
  entity_type: string;
  canonical_name: string;
  confidence: number | null;
}

interface EntityBadgesProps {
  contentItemId: string;
  className?: string;
}

/** Map entity_type DB values to human-readable UK English labels */
const ENTITY_TYPE_LABELS: Record<string, string> = {
  organisation: 'Organisations',
  person: 'People',
  certification: 'Certifications',
  regulation: 'Regulations',
  technology: 'Technologies',
  methodology: 'Methodologies',
  standard: 'Standards',
  location: 'Locations',
  product: 'Products',
  framework: 'Frameworks',
  sector: 'Sectors',
  client: 'Clients',
  project: 'Projects',
};

function getTypeLabel(entityType: string): string {
  return (
    ENTITY_TYPE_LABELS[entityType] ??
    entityType.charAt(0).toUpperCase() + entityType.slice(1) + 's'
  );
}

function ErrorState({
  onRetry,
  message,
  className,
}: {
  onRetry: () => void;
  message: string;
  className?: string;
}) {
  return (
    <section
      className={className}
      aria-label="Entities mentioned in this content"
    >
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Entities
      </h3>
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <p className="mb-3">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="gap-1.5"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </section>
  );
}

/**
 * Displays entity mentions for a content item, grouped by type.
 * Renders nothing if no entities are found (graceful empty state).
 */
export function EntityBadges({ contentItemId, className }: EntityBadgesProps) {
  const [entities, setEntities] = useState<EntityMention[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchEntities = useCallback(async () => {
    setError(null);
    setLoaded(false);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('entity_mentions')
        .select('id, entity_type, canonical_name, confidence')
        .eq('source_document_id', contentItemId)
        .order('entity_type')
        .order('canonical_name');

      if (fetchError) {
        captureClientException(fetchError, {
          scope: 'item-detail.entity-badges.fetchMentions',
          extras: { contentItemId },
        });
        setError(
          fetchError instanceof Error
            ? fetchError
            : new Error(String(fetchError)),
        );
        return;
      }

      if (data) {
        // Deduplicate by canonical_name within each type
        const seen = new Set<string>();
        const deduped = (data as EntityMention[]).filter((e) => {
          const key = `${e.entity_type}:${e.canonical_name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setEntities(deduped);
      }
    } finally {
      setLoaded(true);
    }
  }, [contentItemId]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  // Don't render anything until loaded
  if (!loaded) {
    return null;
  }

  if (error) {
    return (
      <ErrorState
        className={className}
        onRetry={fetchEntities}
        message="Couldn't load entities. Please try again."
      />
    );
  }

  // Empty state
  if (entities.length === 0) {
    return (
      <section
        className={className}
        aria-label="Entities mentioned in this content"
      >
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Entities
        </h3>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <FileX className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No entities detected in this content.
          </p>
        </div>
      </section>
    );
  }

  // Group by entity type
  const grouped = entities.reduce<Record<string, EntityMention[]>>(
    (acc, entity) => {
      const type = entity.entity_type;
      if (!acc[type]) acc[type] = [];
      acc[type].push(entity);
      return acc;
    },
    {},
  );

  // Sort type groups by label
  const sortedTypes = Object.keys(grouped).sort((a, b) =>
    getTypeLabel(a).localeCompare(getTypeLabel(b)),
  );

  return (
    <section
      className={className}
      aria-label="Entities mentioned in this content"
    >
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Entities
      </h3>
      <div className="space-y-2">
        {sortedTypes.map((type) => (
          <div key={type} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground mr-0.5">
              {getTypeLabel(type)}:
            </span>
            {grouped[type].map((entity) => (
              <Badge
                key={entity.id}
                variant="outline"
                className="text-xs font-normal"
              >
                {entity.canonical_name}
              </Badge>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
