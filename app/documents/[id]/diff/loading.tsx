import { Skeleton } from '@/components/ui/skeleton';

export default function DiffLoading() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading diff review"
    >
      <span className="sr-only">Loading diff review...</span>
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-9 w-28" />
      </div>
      {/* Version info skeleton */}
      <div className="mt-4 flex gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-40" />
      </div>
      {/* Summary stats skeleton */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Diff entries skeleton */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
