import { Suspense } from 'react';
import { CoveragePageTabs } from './coverage-tabs';

export default function CoveragePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Suspense fallback={<CoveragePageSkeleton />}>
        <CoveragePageTabs />
      </Suspense>
    </div>
  );
}

function CoveragePageSkeleton() {
  return (
    <div>
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-56 animate-pulse rounded-md bg-accent" />
          <div className="mt-1.5 h-4 w-72 animate-pulse rounded-md bg-accent" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-[180px] animate-pulse rounded-md bg-accent" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-accent" />
        </div>
      </div>

      {/* Summary cards skeleton */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="h-10 w-10 animate-pulse rounded-lg bg-accent" />
            <div className="h-3 w-20 animate-pulse rounded bg-accent" />
            <div className="h-8 w-16 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>

      {/* Domain sections skeleton */}
      <div className="mt-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-lg border border-border bg-accent"
          />
        ))}
      </div>
    </div>
  );
}
