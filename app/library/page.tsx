import { Suspense } from 'react';
import { LibraryContent } from './library-content';

export default function LibraryPage() {
  return (
    <Suspense fallback={<LibraryPageSkeleton />}>
      <LibraryContent />
    </Suspense>
  );
}

function LibraryPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" role="status" aria-label="Loading library page">
      <span className="sr-only">Loading library page...</span>
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
      </div>
      <div className="mt-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4"
          >
            <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
