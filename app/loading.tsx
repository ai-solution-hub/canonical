export default function DashboardLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading dashboard"
    >
      <span className="sr-only">Loading dashboard...</span>

      {/* Search hero skeleton */}
      <div className="mx-auto w-full max-w-xl">
        <div className="h-12 w-full animate-pulse rounded-xl bg-accent" />
      </div>

      {/* Two-column grid: attention + bids */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Attention column */}
        <div className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-accent" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 w-full animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
        {/* Bids column */}
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded bg-accent" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-16 w-full animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      </div>

      {/* Stats strip skeleton */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4"
          >
            <div className="h-3 w-20 animate-pulse rounded bg-accent" />
            <div className="h-7 w-12 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>

      {/* Activity feed skeleton */}
      <div className="mt-6 space-y-2">
        <div className="h-4 w-28 animate-pulse rounded bg-accent" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded-lg border bg-card" />
        ))}
      </div>
    </div>
  );
}
