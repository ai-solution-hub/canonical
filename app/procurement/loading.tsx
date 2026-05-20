export default function ProcurementLoading() {
  return (
    <div
      role="status"
      aria-label="Loading bids"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <span className="sr-only">Loading bids...</span>

      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-32 animate-pulse rounded-md bg-accent" />
      </div>

      {/* Procurement cards skeleton */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <div className="h-5 w-2/3 animate-pulse rounded bg-accent" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
            </div>
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-accent" />
            <div className="mt-2 flex items-center gap-2">
              <div className="h-4 w-20 animate-pulse rounded bg-accent" />
              <div className="h-4 w-24 animate-pulse rounded bg-accent" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
