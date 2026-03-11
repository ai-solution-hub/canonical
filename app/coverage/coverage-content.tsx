'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, LayoutGrid, Download } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CoverageSummaryCards,
  type CoverageSummaryRow,
} from '@/components/coverage-summary-cards';
import { CoverageDomainSection } from '@/components/coverage-domain-section';
import { CoverageLayerFilter } from '@/components/coverage-layer-filter';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import type { CoverageCellData } from '@/components/coverage-cell';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageResponse {
  matrix: CoverageCellData[];
  summary: CoverageSummaryRow[];
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function CoverageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>

      {/* Domain sections skeleton */}
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function CoverageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card px-6 py-12 text-center">
      <LayoutGrid className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="size-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function CoverageEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <LayoutGrid className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No taxonomy configured
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure domains and subtopics in Settings to see coverage data.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-4">
        <Link href="/settings">Go to Settings</Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Freshness distribution bar for domain section headers
// ---------------------------------------------------------------------------

interface FreshnessDistribution {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

function FreshnessDistributionBar({ dist, total }: { dist: FreshnessDistribution; total: number }) {
  if (total === 0) return null;

  const segments: { key: string; count: number; bgClass: string; textClass: string; label: string }[] = [
    { key: 'fresh', count: dist.fresh, bgClass: 'bg-freshness-fresh', textClass: 'text-freshness-fresh', label: 'Fresh' },
    { key: 'aging', count: dist.aging, bgClass: 'bg-freshness-aging', textClass: 'text-freshness-aging', label: 'Ageing' },
    { key: 'stale', count: dist.stale, bgClass: 'bg-freshness-stale', textClass: 'text-freshness-stale', label: 'Stale' },
    { key: 'expired', count: dist.expired, bgClass: 'bg-freshness-expired', textClass: 'text-freshness-expired', label: 'Expired' },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-24 overflow-hidden rounded-full" role="img" aria-label={`Freshness: ${segments.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}`}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={cn('h-full', seg.bgClass)}
            style={{ width: `${(seg.count / total) * 100}%` }}
          />
        ))}
      </div>
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {segments.map((seg) => (
          <span key={seg.key} className={seg.textClass}>{seg.count}</span>
        ))}
      </span>
    </div>
  );
}

function computeDomainFreshness(cells: CoverageCellData[]): FreshnessDistribution {
  return cells.reduce(
    (acc, c) => ({
      fresh: acc.fresh + c.fresh_count,
      aging: acc.aging + c.aging_count,
      stale: acc.stale + c.stale_count,
      expired: acc.expired + c.expired_count,
    }),
    { fresh: 0, aging: 0, stale: 0, expired: 0 },
  );
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function exportCoverageCSV(
  matrix: CoverageCellData[],
  formatSubtopic: (s: string) => string,
  formatDomainName: (d: string) => string,
) {
  const header = 'Domain,Subtopic,Item Count,Fresh,Ageing,Stale,Expired';
  const rows = matrix.map((cell) =>
    [
      `"${formatDomainName(cell.domain_name)}"`,
      `"${formatSubtopic(cell.subtopic_name)}"`,
      cell.item_count,
      cell.fresh_count,
      cell.aging_count,
      cell.stale_count,
      cell.expired_count,
    ].join(','),
  );

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `coverage-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Coverage Content (client component)
// ---------------------------------------------------------------------------

export function CoverageContent() {
  const { getSubtopics, getDomainColourKey, formatSubtopic, formatDomainName } =
    useTaxonomy();

  const [data, setData] = useState<CoverageResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<string | null>(null);

  // Fetch coverage data
  const fetchCoverage = useCallback(async (layer: string | null) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (layer) params.set('layer', layer);

      const res = await fetch(`/api/coverage?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || `Failed to load coverage data (${res.status})`,
        );
      }

      const json: CoverageResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load coverage data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch on mount and when layer filter changes
  useEffect(() => {
    fetchCoverage(layerFilter);
  }, [fetchCoverage, layerFilter]);

  const handleRetry = useCallback(() => {
    fetchCoverage(layerFilter);
  }, [fetchCoverage, layerFilter]);

  const handleLayerChange = useCallback((layer: string | null) => {
    setLayerFilter(layer);
  }, []);

  // Group matrix data by domain
  const groupedByDomain = useMemo(() => {
    if (!data?.matrix) return new Map<string, CoverageCellData[]>();

    const map = new Map<string, CoverageCellData[]>();
    for (const row of data.matrix) {
      const existing = map.get(row.domain_name) ?? [];
      existing.push(row);
      map.set(row.domain_name, existing);
    }
    return map;
  }, [data?.matrix]);

  // Get ordered domain names from summary (preserves taxonomy order)
  const orderedDomains = useMemo(() => {
    if (!data?.summary) return [];
    return data.summary.map((s) => s.domain_name);
  }, [data?.summary]);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2">
        <CoverageLayerFilter
          value={layerFilter}
          onLayerChange={handleLayerChange}
        />
        {data?.matrix && data.matrix.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCoverageCSV(data.matrix, formatSubtopic, formatDomainName)}
            className="gap-1.5"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Export CSV
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={isLoading}
          className="gap-1.5"
        >
          <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Content */}
      <div className="mt-6 space-y-6">
        {isLoading ? (
          <div role="status" aria-label="Loading coverage data">
            <CoverageSkeleton />
          </div>
        ) : error ? (
          <CoverageError message={error} onRetry={handleRetry} />
        ) : !data || data.summary.length === 0 ? (
          <CoverageEmpty />
        ) : (
          <>
            {/* Summary cards */}
            <CoverageSummaryCards summary={data.summary} />
            <p className="text-xs text-muted-foreground">Trend data coming soon</p>

            {/* Domain sections */}
            <div className="space-y-4">
              {orderedDomains.map((domainName, index) => {
                const cells = groupedByDomain.get(domainName) ?? [];
                const allSubtopics = getSubtopics(domainName);
                const freshnessDist = computeDomainFreshness(cells);
                const totalItems = cells.reduce((sum, c) => sum + c.item_count, 0);

                return (
                  <div key={domainName}>
                    {totalItems > 0 && (
                      <div className="mb-1 flex justify-end px-1">
                        <FreshnessDistributionBar dist={freshnessDist} total={totalItems} />
                      </div>
                    )}
                    <CoverageDomainSection
                      domainName={domainName}
                      displayName={formatDomainName(domainName)}
                      colourKey={getDomainColourKey(domainName)}
                      cells={cells}
                      allSubtopics={allSubtopics}
                      defaultExpanded={index === 0}
                      formatSubtopic={formatSubtopic}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
