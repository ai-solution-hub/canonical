'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CoverageGuideCard,
  type GuideCoverageData,
} from '@/components/coverage/coverage-guide-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuideCoverageSummary {
  total_guides: number;
  fully_populated: number;
  partially_populated: number;
  empty: number;
}

interface GuideCoverageResponse {
  guides: GuideCoverageData[];
  summary: GuideCoverageSummary;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function GuideCoverageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading coverage guides">
      <span className="sr-only">Loading coverage guides...</span>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <Skeleton key={i} className="h-64 rounded-xl" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function GuideEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <BookOpen
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No guides published
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Publish a guide to see section-level coverage tracking here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function GuideError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/30 px-6 py-16 text-center">
      <p className="text-sm text-destructive">
        Failed to load guide coverage data.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
        <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoverageGuideTab() {
  const [data, setData] = useState<GuideCoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const searchParams = useSearchParams();
  const focusSlug = searchParams.get('id');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/coverage/guides');
      if (!res.ok) throw new Error('Failed to fetch');
      const json: GuideCoverageResponse = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!focusSlug || loading) return;
    const el = document.getElementById(`guide-${focusSlug}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusSlug, loading]);

  if (loading) return <GuideCoverageSkeleton />;
  if (error) return <GuideError onRetry={fetchData} />;
  if (!data || data.guides.length === 0) return <GuideEmpty />;

  const { guides, summary } = data;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total guides" value={summary.total_guides} />
        <SummaryCard
          label="Fully populated"
          value={summary.fully_populated}
        />
        <SummaryCard
          label="Partially populated"
          value={summary.partially_populated}
        />
        <SummaryCard label="Empty" value={summary.empty} />
      </div>

      {/* Guide cards */}
      <div className="space-y-4">
        {guides.map((guide) => (
          <CoverageGuideCard
            key={guide.id}
            guide={guide}
            highlighted={guide.slug === focusSlug}
          />
        ))}
      </div>
    </div>
  );
}
