export default function ReviewLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-40 animate-pulse rounded-md bg-accent" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 animate-pulse rounded-full bg-accent" />
          <div className="h-8 w-24 animate-pulse rounded-full bg-accent" />
        </div>
      </div>

      {/* Progress bar skeleton */}
      <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-accent" />

      {/* Review cards skeleton */}
      <div className="mt-6 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex gap-4 rounded-lg border border-border bg-card p-4"
          >
            <div className="h-16 w-16 shrink-0 animate-pulse rounded-md bg-accent" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-full animate-pulse rounded bg-accent" />
              <div className="flex gap-2">
                <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
                <div className="h-5 w-20 animate-pulse rounded-full bg-accent" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
