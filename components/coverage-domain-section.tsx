'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CoverageCell, type CoverageCellData } from '@/components/coverage-cell';
import { CoverageGapCell } from '@/components/coverage-gap-cell';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageDomainSectionProps {
  /** Domain name (kebab-case slug) */
  domainName: string;
  /** Formatted display name */
  displayName: string;
  /** CSS colour key for the domain dot */
  colourKey: string;
  /** Matrix rows for this domain (subtopics with items) */
  cells: CoverageCellData[];
  /** All subtopic names for this domain (from taxonomy) */
  allSubtopics: string[];
  /** Whether this section starts expanded */
  defaultExpanded?: boolean;
  /** Format subtopic slug to display name */
  formatSubtopic: (subtopic: string) => string;
}

// ---------------------------------------------------------------------------
// Domain colour dot
// ---------------------------------------------------------------------------

const COLOUR_MAP: Record<string, string> = {
  security: 'bg-blue-600',
  compliance: 'bg-violet-600',
  implementation: 'bg-emerald-600',
  support: 'bg-cyan-600',
  corporate: 'bg-slate-600',
  product: 'bg-orange-500',
  methodology: 'bg-rose-600',
};

function getDomainDotColour(colourKey: string): string {
  return COLOUR_MAP[colourKey] ?? 'bg-primary';
}

// ---------------------------------------------------------------------------
// Coverage Domain Section
// ---------------------------------------------------------------------------

export function CoverageDomainSection({
  domainName,
  displayName,
  colourKey,
  cells,
  allSubtopics,
  defaultExpanded = false,
  formatSubtopic,
}: CoverageDomainSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // Build a set of subtopics that have items
  const subtopicsWithItems = new Set(cells.map((c) => c.subtopic_name));
  const totalItemCount = cells.reduce((sum, c) => sum + c.item_count, 0);
  const gapSubtopics = allSubtopics.filter((s) => !subtopicsWithItems.has(s));
  const gapCount = gapSubtopics.length;

  return (
    <section
      className="rounded-lg border border-border bg-card"
      aria-label={`${displayName} coverage`}
    >
      {/* Header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left',
          'transition-colors hover:bg-accent/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          expanded && 'border-b border-border',
        )}
        aria-expanded={expanded}
      >
        {/* Expand/collapse icon */}
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}

        {/* Domain colour dot */}
        <span
          className={cn('size-3 shrink-0 rounded-full', getDomainDotColour(colourKey))}
          aria-hidden="true"
        />

        {/* Domain name */}
        <span className="font-medium text-foreground">{displayName}</span>

        {/* Item count */}
        <span className="text-sm text-muted-foreground">
          {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'}
        </span>

        {/* Gap count badge */}
        {gapCount > 0 && (
          <Badge variant="outline" className="ml-auto text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-600">
            {gapCount} {gapCount === 1 ? 'gap' : 'gaps'}
          </Badge>
        )}
      </button>

      {/* Expanded content — grid of subtopic cells */}
      {expanded && (
        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {/* Subtopics with items */}
            {cells.map((cell) => (
              <CoverageCell
                key={cell.subtopic_name}
                data={cell}
                formatSubtopic={formatSubtopic}
              />
            ))}

            {/* Gap cells — subtopics with 0 items */}
            {gapSubtopics.map((subtopic) => (
              <CoverageGapCell
                key={subtopic}
                domainName={domainName}
                subtopicName={subtopic}
                formatSubtopic={formatSubtopic}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
