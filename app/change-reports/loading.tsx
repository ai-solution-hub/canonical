export default function ChangeReportLoading() {
  return (
    <div
      role="status"
      aria-label="Loading change report"
      className="mx-auto max-w-5xl px-4 py-12 sm:px-6"
    >
      <span className="sr-only">Loading change report...</span>
      <div className="space-y-6">
        {/* Title and date skeleton */}
        <div className="space-y-3">
          <div className="h-8 w-64 animate-pulse rounded-md bg-accent" />
          <div className="h-4 w-48 animate-pulse rounded bg-accent" />
        </div>

        {/* Narrative card skeleton */}
        <div className="h-48 w-full animate-pulse rounded-xl bg-accent" />

        {/* Domain summary cards skeleton */}
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-xl border bg-card p-5"
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 animate-pulse rounded bg-accent" />
                <div className="h-5 w-36 animate-pulse rounded bg-accent" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-accent" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-accent" />
                <div className="h-3 w-4/6 animate-pulse rounded bg-accent" />
              </div>
              <div className="flex gap-2 pt-2">
                <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
                <div className="h-5 w-20 animate-pulse rounded-full bg-accent" />
              </div>
            </div>
          ))}
        </div>

        {/* Theme clusters skeleton */}
        <div className="mt-4 space-y-3">
          <div className="h-5 w-32 animate-pulse rounded bg-accent" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-accent"
                style={{ width: `${90 + i * 15}px` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
