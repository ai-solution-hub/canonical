import { Suspense } from 'react';
import { GuideContent } from './guide-content';

export default function GuidesPage() {
  return (
    <Suspense fallback={<GuidesPageSkeleton />}>
      <GuideContent />
    </Suspense>
  );
}

function GuidesPageSkeleton() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading guides page"
    >
      <span className="sr-only">Loading guides page...</span>
      {/* Header skeleton */}
      <div className="flex items-center gap-3">
        <div className="size-6 animate-pulse rounded bg-accent" />
        <div>
          <div className="h-5 w-32 animate-pulse rounded bg-accent" />
          <div className="mt-1 h-3 w-64 animate-pulse rounded bg-accent" />
        </div>
      </div>
      {/* Filter bar skeleton */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="h-9 flex-1 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-[140px] animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-[160px] animate-pulse rounded-md bg-accent" />
      </div>
      {/* Grid skeleton */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          >
            <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-accent" />
            <div className="flex gap-1.5">
              <div className="h-5 w-16 animate-pulse rounded bg-accent" />
              <div className="h-5 w-20 animate-pulse rounded bg-accent" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
