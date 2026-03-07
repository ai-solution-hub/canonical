'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border bg-card px-6 py-12">
      <p className="text-sm text-destructive">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="size-3.5" />
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12">
      <p className="text-sm font-medium text-muted-foreground">
        No taxonomy configured
      </p>
      <p className="text-xs text-muted-foreground/70">
        Configure domains and subtopics in Settings to see coverage data.
      </p>
    </div>
  );
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Coverage Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Content coverage across domains and subtopics
          </p>
        </div>

        <div className="flex items-center gap-2">
          <CoverageLayerFilter
            value={layerFilter}
            onLayerChange={handleLayerChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="mt-6 space-y-6">
        {isLoading ? (
          <CoverageSkeleton />
        ) : error ? (
          <CoverageError message={error} onRetry={handleRetry} />
        ) : !data || data.summary.length === 0 ? (
          <CoverageEmpty />
        ) : (
          <>
            {/* Summary cards */}
            <CoverageSummaryCards summary={data.summary} />

            {/* Domain sections */}
            <div className="space-y-4">
              {orderedDomains.map((domainName, index) => {
                const cells = groupedByDomain.get(domainName) ?? [];
                const allSubtopics = getSubtopics(domainName);

                return (
                  <CoverageDomainSection
                    key={domainName}
                    domainName={domainName}
                    displayName={formatDomainName(domainName)}
                    colourKey={getDomainColourKey(domainName)}
                    cells={cells}
                    allSubtopics={allSubtopics}
                    defaultExpanded={index === 0}
                    formatSubtopic={formatSubtopic}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
