'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  Network,
  ExternalLink,
  AlertTriangle,
  FileText,
  ArrowRight,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { formatContentType } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItemRef {
  id: string;
  title: string;
  content_type: string | null;
}

interface EntityRelationship {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
  confidence: number;
}

interface EntityDetail {
  canonical_name: string;
  entity_type: string;
  effective_type: string;
  has_type_override: boolean;
  mention_count: number;
  variant_names: string[];
  variant_count: number;
  types_seen: string[];
  has_type_conflict: boolean;
  content_items: ContentItemRef[];
  content_item_count: number;
  relationships: EntityRelationship[];
  relationship_count: number;
}

interface EntityDetailPanelProps {
  canonicalName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Type badge colour map (mirrors entity-list.tsx)
// ---------------------------------------------------------------------------

const TYPE_COLOURS: Record<string, string> = {
  organisation: 'bg-entity-organisation-bg text-entity-organisation-text',
  certification: 'bg-entity-certification-bg text-entity-certification-text',
  regulation: 'bg-entity-regulation-bg text-entity-regulation-text',
  framework: 'bg-entity-framework-bg text-entity-framework-text',
  capability: 'bg-entity-capability-bg text-entity-capability-text',
  person: 'bg-entity-person-bg text-entity-person-text',
  technology: 'bg-entity-technology-bg text-entity-technology-text',
  project: 'bg-entity-project-bg text-entity-project-text',
  sector: 'bg-entity-sector-bg text-entity-sector-text',
  product: 'bg-entity-product-bg text-entity-product-text',
};

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('text-xs', TYPE_COLOURS[type])}
    >
      {type}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Relationship display helper
// ---------------------------------------------------------------------------

function formatRelationshipType(type: string): string {
  return type.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EntityDetailPanel({
  canonicalName,
  open,
  onOpenChange,
}: EntityDetailPanelProps) {
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !canonicalName) {
      setDetail(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchDetail() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/entities/${encodeURIComponent(canonicalName!)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to fetch entity (${res.status})`);
        }
        const data: EntityDetail = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load entity detail');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDetail();
    return () => { cancelled = true; };
  }, [open, canonicalName]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Network className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {canonicalName ?? 'Entity Detail'}
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detailed view for entity {canonicalName}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="size-6 text-freshness-aging" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && !error && detail && (
          <div className="flex flex-col gap-6 pt-4">
            {/* ── Type and stats ──────────────────────────────────── */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={detail.effective_type} />
                {detail.has_type_override && (
                  <span className="text-xs text-muted-foreground">
                    (overridden from {detail.entity_type})
                  </span>
                )}
                {detail.has_type_conflict && (
                  <span className="flex items-center gap-1 text-xs text-freshness-aging">
                    <AlertTriangle className="size-3" />
                    Type conflict
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.mention_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Mentions
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.variant_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Variants
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-center">
                  <div className="text-lg font-semibold tabular-nums">
                    {detail.content_item_count}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Content items
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* ── Variant names ───────────────────────────────────── */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Name variants ({detail.variant_count})
              </h4>
              {detail.variant_names.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No variants found.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {detail.variant_names.map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
              {detail.has_type_conflict && detail.types_seen.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Types seen across mentions: {detail.types_seen.join(', ')}
                </p>
              )}
            </div>

            <Separator />

            {/* ── Content items ───────────────────────────────────── */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Content items ({detail.content_item_count})
              </h4>
              {detail.content_items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No content items linked to this entity.
                </p>
              ) : (
                <ul className="space-y-1" role="list">
                  {detail.content_items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/item/${item.id}`}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <FileText
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {item.title}
                        </span>
                        {item.content_type && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatContentType(item.content_type)}
                          </span>
                        )}
                        <ExternalLink
                          className="size-3 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Relationships ───────────────────────────────────── */}
            {detail.relationships.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    Relationships ({detail.relationship_count})
                  </h4>
                  <ul className="space-y-1.5" role="list">
                    {detail.relationships.map((rel, idx) => {
                      const isSource = rel.source_entity === detail.canonical_name;
                      const otherEntity = isSource ? rel.target_entity : rel.source_entity;

                      return (
                        <li
                          key={`${rel.source_entity}-${rel.relationship_type}-${rel.target_entity}-${idx}`}
                          className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <span className="shrink-0 font-medium">
                            {detail.canonical_name}
                          </span>
                          <ArrowRight
                            className={cn(
                              'size-3.5 shrink-0 text-muted-foreground',
                              !isSource && 'rotate-180',
                            )}
                            aria-hidden="true"
                          />
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatRelationshipType(rel.relationship_type)}
                          </span>
                          <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {otherEntity}
                          </span>
                          {rel.confidence < 1 && (
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {Math.round(rel.confidence * 100)}%
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
