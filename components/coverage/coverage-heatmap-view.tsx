'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { cn } from '@/lib/utils';
import {
  computeHeatmapLevel,
  HEATMAP_LEVEL_CLASSES,
  buildHeatmapColumns,
  buildCellMap,
} from '@/lib/coverage-heatmap';
import type { CoverageCellData } from '@/components/coverage/coverage-cell';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CoverageHeatmapViewProps {
  /** Matrix data from get_coverage_matrix RPC */
  matrix: CoverageCellData[];
  /** Ordered domain names (from summary, preserving taxonomy order) */
  orderedDomains: string[];
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

const LEGEND_ITEMS: {
  label: string;
  cellClass: string;
  borderClass: string;
  dashed?: boolean;
}[] = [
  {
    label: 'Fresh',
    cellClass: 'bg-freshness-fresh-bg',
    borderClass: 'border-freshness-fresh/30',
  },
  {
    label: 'Ageing',
    cellClass: 'bg-freshness-aging-bg',
    borderClass: 'border-freshness-aging/30',
  },
  {
    label: 'Mixed',
    cellClass: 'bg-freshness-aging-bg',
    borderClass: 'border-freshness-aging',
  },
  {
    label: 'Stale',
    cellClass: 'bg-freshness-expired-bg',
    borderClass: 'border-freshness-expired',
  },
  {
    label: 'No content',
    cellClass: 'bg-transparent',
    borderClass: 'border-border',
    dashed: true,
  },
];

function HeatmapLegend() {
  return (
    <div
      role="img"
      aria-label="Heatmap legend: green means fresh, amber means ageing, orange means mixed freshness, red means stale or expired, dashed grey means no content"
      className="mb-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">Legend:</span>
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block size-4 shrink-0 rounded-sm border',
              item.cellClass,
              item.borderClass,
              item.dashed && 'border-dashed',
            )}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

interface HeatmapCellProps {
  cell: CoverageCellData;
  subtopic: string;
  formatSubtopic: (s: string) => string;
}

function HeatmapCell({ cell, subtopic, formatSubtopic }: HeatmapCellProps) {
  const level = computeHeatmapLevel(cell);
  const classes = HEATMAP_LEVEL_CLASSES[level];

  const searchParams = new URLSearchParams({
    domain: cell.domain_name,
    subtopic,
    include_qa: 'true',
  });
  const browseUrl = `/browse?${searchParams.toString()}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={browseUrl}
          className={cn(
            'flex min-h-12 min-w-12 items-center justify-center border',
            classes.cell,
            classes.border,
            'transition-colors hover:opacity-80',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="text-sm font-bold tabular-nums text-foreground">
            {cell.item_count}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1 text-xs">
          <p className="font-medium">{formatSubtopic(subtopic)}</p>
          <p>
            {cell.item_count} {cell.item_count === 1 ? 'item' : 'items'}
          </p>
          <div className="flex gap-2">
            <span className="text-freshness-fresh">
              {cell.fresh_count} Fresh
            </span>
            <span className="text-freshness-aging">
              {cell.aging_count} Ageing
            </span>
            <span className="text-freshness-stale">
              {cell.stale_count} Stale
            </span>
            <span className="text-freshness-expired">
              {cell.expired_count} Expired
            </span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Gap cell (subtopic belongs to domain but has 0 items)
// ---------------------------------------------------------------------------

interface GapCellProps {
  domain: string;
  subtopic: string;
}

function GapCell({ domain, subtopic }: GapCellProps) {
  const searchParams = new URLSearchParams({
    domain,
    subtopic,
    include_qa: 'true',
  });
  const browseUrl = `/browse?${searchParams.toString()}`;

  return (
    <Link
      href={browseUrl}
      className={cn(
        'flex min-h-12 min-w-12 items-center justify-center border border-dashed border-border',
        'transition-colors hover:bg-accent/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="text-sm font-bold tabular-nums text-muted-foreground">
        0
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoverageHeatmapView({
  matrix,
  orderedDomains,
}: CoverageHeatmapViewProps) {
  const { getSubtopics, formatSubtopic, formatDomainName, getDomainColourKey } =
    useTaxonomy();

  const allColumns = useMemo(
    () => buildHeatmapColumns(orderedDomains, getSubtopics),
    [orderedDomains, getSubtopics],
  );

  const cellMap = useMemo(() => buildCellMap(matrix), [matrix]);

  // Pre-compute which subtopics belong to each domain for spacer detection
  const domainSubtopicSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const domain of orderedDomains) {
      map.set(domain, new Set(getSubtopics(domain)));
    }
    return map;
  }, [orderedDomains, getSubtopics]);

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <HeatmapLegend />

        <div className="overflow-x-auto">
          <table
          role="grid"
          aria-label="Freshness heatmap"
          className="border-separate border-spacing-0.5"
        >
          <thead>
            <tr>
              {/* Empty corner cell */}
              <th className="sticky left-0 z-10 bg-card" />
              {allColumns.map((subtopic) => (
                <th
                  key={subtopic}
                  className="min-w-12 px-0.5 pb-2 text-left align-bottom"
                >
                  <span
                    className="inline-block origin-bottom-left -rotate-45 whitespace-nowrap text-xs font-medium text-muted-foreground"
                    title={formatSubtopic(subtopic)}
                  >
                    {formatSubtopic(subtopic)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedDomains.map((domain) => {
              const colourKey = getDomainColourKey(domain);
              const subtopicSet = domainSubtopicSets.get(domain);

              return (
                <tr key={domain}>
                  {/* Domain label — sticky for horizontal scroll */}
                  <th
                    className="sticky left-0 z-10 bg-card pr-3 text-left align-middle"
                    scope="row"
                  >
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-foreground">
                      <span
                        className={cn(
                          'inline-block size-2.5 shrink-0 rounded-full',
                          `bg-domain-${colourKey}`,
                        )}
                        aria-hidden="true"
                      />
                      {formatDomainName(domain)}
                    </span>
                  </th>

                  {/* Cells */}
                  {allColumns.map((subtopic) => {
                    const belongsToDomain = subtopicSet?.has(subtopic) ?? false;

                    if (!belongsToDomain) {
                      // Neutral spacer — subtopic does not belong to this domain
                      return (
                        <td
                          key={subtopic}
                          className="min-h-12 min-w-12"
                          aria-hidden="true"
                        />
                      );
                    }

                    const cell = cellMap.get(`${domain}::${subtopic}`);

                    if (!cell || cell.item_count === 0) {
                      // Gap cell — subtopic belongs to domain but has 0 items
                      return (
                        <td key={subtopic}>
                          <GapCell domain={domain} subtopic={subtopic} />
                        </td>
                      );
                    }

                    // Populated cell with freshness colouring
                    return (
                      <td key={subtopic}>
                        <HeatmapCell
                          cell={cell}
                          subtopic={subtopic}
                          formatSubtopic={formatSubtopic}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}
