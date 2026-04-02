export default function ReviewLoading() {
  return (
    <div
      role="status"
      aria-label="Loading review queue"
      className="mx-auto max-w-[800px] px-4 py-8 sm:px-6"
    >
      <span className="sr-only">Loading review queue...</span>

      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="h-7 w-40 animate-pulse rounded-md bg-accent" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-accent" />
        </div>
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
      </div>

      {/* Progress bar skeleton */}
      <div className="mb-6 h-2 w-full animate-pulse rounded-full bg-accent" />

      {/* Single card skeleton */}
      <div className="rounded-xl border bg-card p-6">
        <div className="flex gap-2">
          <div className="h-5 w-24 animate-pulse rounded-full bg-accent" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
        </div>
        <div className="mt-4 h-6 w-3/4 animate-pulse rounded bg-accent" />
        <div className="mt-6 space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-accent" />
          <div className="h-4 w-full animate-pulse rounded bg-accent" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-accent" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-accent" />
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <div className="h-3 w-20 animate-pulse rounded bg-accent" />
          <div className="mt-2 h-4 w-48 animate-pulse rounded bg-accent" />
        </div>
      </div>

      {/* Action bar skeleton */}
      <div className="mt-4 h-14 w-full animate-pulse rounded-lg bg-accent" />
    </div>
  );
}
