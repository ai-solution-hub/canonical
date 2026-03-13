'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2,
  Search,
  Network,
  AlertTriangle,
  Merge,
  Scissors,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { VALID_ENTITY_TYPES } from '@/lib/validation/schemas';
import { MergeModal } from './merge-modal';
import type { EntityForMerge } from './merge-modal';
import { SplitModal } from './split-modal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntityRow {
  canonical_name: string;
  entity_type: string;
  mention_count: number;
  variant_count: number;
  variant_names: string[];
  relationship_count: number;
  has_type_conflict: boolean;
  types_seen: string[];
}

// ---------------------------------------------------------------------------
// Type badge colour map
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

function TypeBadge({
  type,
  onClick,
}: {
  type: string;
  onClick?: () => void;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'cursor-default text-xs',
        TYPE_COLOURS[type],
        onClick && 'cursor-pointer hover:opacity-80',
      )}
      onClick={onClick}
    >
      {type}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Expandable row
// ---------------------------------------------------------------------------

function EntityRowItem({
  entity,
  isSelected,
  onToggleSelect,
  onSplit,
  onEditType,
}: {
  entity: EntityRow;
  isSelected: boolean;
  onToggleSelect: () => void;
  onSplit: () => void;
  onEditType: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${entity.canonical_name}`}
        />

        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {entity.canonical_name}
            </span>
            {entity.has_type_conflict && (
              <AlertTriangle
                className="size-3.5 shrink-0 text-freshness-aging"
                aria-label="Type conflict"
              />
            )}
            {entity.variant_count > 1 && (
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            )}
          </div>
        </button>

        <TypeBadge type={entity.entity_type} onClick={onEditType} />

        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          title="Mentions"
        >
          {entity.mention_count}m
        </span>
        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          title="Variants"
        >
          {entity.variant_count}v
        </span>
        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          title="Relationships"
        >
          {entity.relationship_count}r
        </span>

        {entity.variant_count > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 p-0"
            title="Split entity"
            aria-label={`Split ${entity.canonical_name}`}
            onClick={onSplit}
          >
            <Scissors className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Expanded variant names */}
      {expanded && entity.variant_count > 1 && (
        <div className="bg-muted/30 px-12 py-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Variant names ({entity.variant_count}):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entity.variant_names.map((v) => (
              <Badge key={v} variant="secondary" className="text-xs">
                {v}
              </Badge>
            ))}
          </div>
          {entity.has_type_conflict && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Types seen: {entity.types_seen.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type edit popover (inline select)
// ---------------------------------------------------------------------------

function TypeEditDialog({
  open,
  onOpenChange,
  entity,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: EntityRow | null;
  onComplete: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState('');

  useEffect(() => {
    if (entity) setSelectedType(entity.entity_type);
  }, [entity]);

  async function handleSave() {
    if (!entity || !selectedType || selectedType === entity.entity_type) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/entities/${encodeURIComponent(entity.canonical_name)}/type`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: selectedType }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update type');

      toast.success(
        `Updated "${entity.canonical_name}" type to ${selectedType} (${data.mentions_updated} mentions)`,
      );
      onOpenChange(false);
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update type');
    } finally {
      setLoading(false);
    }
  }

  if (!entity) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            Change type for &ldquo;{entity.canonical_name}&rdquo;
          </DialogTitle>
        </DialogHeader>
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VALID_ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={loading || selectedType === entity.entity_type}
            onClick={handleSave}
          >
            {loading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main EntityList
// ---------------------------------------------------------------------------

export function EntityList() {
  // Data state
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [variantsOnly, setVariantsOnly] = useState(false);
  const [typeConflicts, setTypeConflicts] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [splitEntity, setSplitEntity] = useState<EntityRow | null>(null);
  const [typeEditEntity, setTypeEditEntity] = useState<EntityRow | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────
  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (searchQuery) params.set('search', searchQuery);
      if (variantsOnly) params.set('variants_only', 'true');
      if (typeConflicts) params.set('type_conflicts', 'true');
      params.set('limit', '500');

      const res = await fetch(`/api/entities?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch entities');
      const data = await res.json();
      setEntities(data.entities);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load entities');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, searchQuery, variantsOnly, typeConflicts]);

  useEffect(() => {
    const timer = setTimeout(fetchEntities, 300);
    return () => clearTimeout(timer);
  }, [fetchEntities]);

  // ─── Selection helpers ──────────────────────────────────────────────
  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  // ─── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const withVariants = entities.filter((e) => e.variant_count > 1).length;
    const withConflicts = entities.filter((e) => e.has_type_conflict).length;
    return { total, withVariants, withConflicts };
  }, [entities, total]);

  // ─── Merge prep ─────────────────────────────────────────────────────
  const selectedEntities: EntityForMerge[] = entities
    .filter((e) => selected.has(e.canonical_name))
    .map((e) => ({
      canonical_name: e.canonical_name,
      entity_type: e.entity_type,
      mention_count: e.mention_count,
    }));

  function handleMergeComplete() {
    clearSelection();
    fetchEntities();
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Network className="size-5 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Entity Management</h3>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="text-2xl font-semibold tabular-nums">
              {stats.total.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground">
              Unique entities
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {stats.withVariants}
              </span>
              {stats.withVariants > 0 && (
                <AlertTriangle
                  className="size-4 text-freshness-aging"
                  aria-label="Have variants"
                />
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              With name variants
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {stats.withConflicts}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Type conflicts
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search entities"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {VALID_ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={variantsOnly}
              onChange={(e) => setVariantsOnly(e.target.checked)}
              className="accent-primary"
            />
            Show variants only
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={typeConflicts}
              onChange={(e) => setTypeConflicts(e.target.checked)}
              className="accent-primary"
            />
            Show type conflicts
          </label>
          <span className="text-xs text-muted-foreground">
            {entities.length.toLocaleString()} entit{entities.length !== 1 ? 'ies' : 'y'} shown
          </span>
        </div>

        {/* Selection actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
            <span className="text-sm font-medium">
              {selected.size} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={selected.size < 2}
              onClick={() => setMergeOpen(true)}
            >
              <Merge className="size-3.5" />
              Merge
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Entity list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : entities.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Network className="size-8 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {searchQuery
              ? 'No entities matching your search.'
              : 'No entities found.'}
          </p>
        </div>
      ) : (
        <div
          className="max-h-[600px] overflow-auto rounded-md border"
          role="list"
          aria-label="Entity list"
        >
          {entities.map((entity) => (
            <EntityRowItem
              key={entity.canonical_name}
              entity={entity}
              isSelected={selected.has(entity.canonical_name)}
              onToggleSelect={() => toggleSelect(entity.canonical_name)}
              onSplit={() => setSplitEntity(entity)}
              onEditType={() => setTypeEditEntity(entity)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <MergeModal
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        entities={selectedEntities}
        onMergeComplete={handleMergeComplete}
      />

      {splitEntity && (
        <SplitModal
          open={!!splitEntity}
          onOpenChange={(open) => !open && setSplitEntity(null)}
          canonicalName={splitEntity.canonical_name}
          variantNames={splitEntity.variant_names}
          onSplitComplete={() => {
            setSplitEntity(null);
            fetchEntities();
          }}
        />
      )}

      <TypeEditDialog
        open={!!typeEditEntity}
        onOpenChange={(open) => !open && setTypeEditEntity(null)}
        entity={typeEditEntity}
        onComplete={() => {
          setTypeEditEntity(null);
          fetchEntities();
        }}
      />
    </div>
  );
}
