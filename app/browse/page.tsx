import { Suspense } from 'react';
import { BrowseContent } from './browse-content';

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowsePageSkeleton />}>
      <BrowseContent />
    </Suspense>
  );
}

function BrowsePageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" role="status" aria-label="Loading browse page">
      <span className="sr-only">Loading browse page...</span>
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 animate-pulse rounded-md bg-accent" />
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-accent" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-accent" />
        </div>
      </div>
      {/* Grid skeleton */}
      <div
        className="mt-6 grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
          >
            <div className="aspect-video w-full animate-pulse rounded-md bg-accent" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
