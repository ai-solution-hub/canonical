'use client';

import {
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Plus,
} from 'lucide-react';
import { formatDomainName, formatSubtopic } from '@/lib/taxonomy-format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { AdminDomain, AdminSubtopic, TaxonomyProvenance } from '@/hooks/use-taxonomy-admin';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DomainCardProps {
  domain: AdminDomain;
  index: number;
  domainCount: number;
  isExpanded: boolean;
  subtopics: AdminSubtopic[];
  onToggle: (domainId: string) => void;
  onEdit: (domain: AdminDomain) => void;
  onDeactivate: (type: 'domain' | 'subtopic', id: string, name: string) => void;
  onReactivate: (type: 'domain' | 'subtopic', id: string, domainId?: string) => void;
  onMoveDomain: (domainId: string, direction: 'up' | 'down') => Promise<void>;
  onMoveSubtopic: (domainId: string, subtopicId: string, direction: 'up' | 'down') => Promise<void>;
  onAddSubtopic: (domainId: string) => void;
  onEditSubtopic: (subtopic: AdminSubtopic) => void;
}

// ---------------------------------------------------------------------------
// Provenance badge
// ---------------------------------------------------------------------------

const PROVENANCE_LABELS: Record<TaxonomyProvenance, string> = {
  baseline: 'Baseline',
  client: 'Client',
  recommended: 'Recommended',
};

const PROVENANCE_VARIANTS: Record<TaxonomyProvenance, 'secondary' | 'outline' | 'default'> = {
  baseline: 'secondary',
  client: 'default',
  recommended: 'outline',
};

function ProvenanceBadge({ provenance }: { provenance: TaxonomyProvenance }) {
  return (
    <Badge variant={PROVENANCE_VARIANTS[provenance]} className="shrink-0 text-[10px]">
      {PROVENANCE_LABELS[provenance]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DomainCard({
  domain,
  index,
  domainCount,
  isExpanded,
  subtopics,
  onToggle,
  onEdit,
  onDeactivate,
  onReactivate,
  onMoveDomain,
  onMoveSubtopic,
  onAddSubtopic,
  onEditSubtopic,
}: DomainCardProps) {
  return (
    <Card className="overflow-hidden">
      {/* Domain header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => onToggle(domain.id)}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={isExpanded ? 'Collapse subtopics' : 'Expand subtopics'}
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">
              {formatDomainName(domain.name)}
            </p>
            <Badge
              variant={domain.is_active ? 'secondary' : 'outline'}
              className="shrink-0"
            >
              {domain.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {domain.provenance && domain.provenance !== 'baseline' && (
              <ProvenanceBadge provenance={domain.provenance} />
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {domain.colour && (
              <span>
                Colour: <code className="rounded bg-muted px-1">{domain.colour}</code>
              </span>
            )}
            <span>Order: {domain.display_order}</span>
            <span>
              {domain.subtopic_count}{' '}
              {domain.subtopic_count === 1 ? 'subtopic' : 'subtopics'}
            </span>
          </div>
        </div>

        {/* Reorder buttons */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === 0}
            onClick={() => onMoveDomain(domain.id, 'up')}
            aria-label="Move domain up"
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={index === domainCount - 1}
            onClick={() => onMoveDomain(domain.id, 'down')}
            aria-label="Move domain down"
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </div>

        {/* Edit / Activate-Deactivate */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(domain)}
          >
            Edit
          </Button>
          {domain.is_active ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() =>
                onDeactivate('domain', domain.id, domain.name)
              }
            >
              Deactivate
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onReactivate('domain', domain.id)
              }
            >
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {/* Subtopics list (expanded) */}
      {isExpanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-3">
          {subtopics.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No subtopics yet. Add subtopics to organise content within this domain.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {subtopics.map((sub, subIdx) => (
                <div
                  key={sub.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm">
                        {formatSubtopic(sub.name)}
                      </p>
                      <Badge
                        variant={sub.is_active ? 'secondary' : 'outline'}
                        className="shrink-0 text-[10px]"
                      >
                        {sub.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {sub.provenance && sub.provenance !== 'baseline' && (
                        <ProvenanceBadge provenance={sub.provenance} />
                      )}
                    </div>
                    {sub.description && (
                      <p className="text-xs text-muted-foreground">
                        {sub.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Order: {sub.display_order}
                    </p>
                  </div>

                  {/* Reorder */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={subIdx === 0}
                      onClick={() =>
                        onMoveSubtopic(domain.id, sub.id, 'up')
                      }
                      aria-label="Move subtopic up"
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={subIdx === subtopics.length - 1}
                      onClick={() =>
                        onMoveSubtopic(domain.id, sub.id, 'down')
                      }
                      aria-label="Move subtopic down"
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </div>

                  {/* Edit / Activate-Deactivate */}
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onEditSubtopic(sub)}
                    >
                      Edit
                    </Button>
                    {sub.is_active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() =>
                          onDeactivate('subtopic', sub.id, sub.name)
                        }
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() =>
                          onReactivate('subtopic', sub.id, domain.id)
                        }
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddSubtopic(domain.id)}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add Subtopic
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
