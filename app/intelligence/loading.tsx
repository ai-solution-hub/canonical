export default function IntelligenceLoading() {
  return (
    <div
      role="status"
      aria-label="Loading intelligence"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <span className="sr-only">Loading intelligence...</span>

      {/* Header: title + button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="h-8 w-48 animate-pulse rounded bg-accent" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-accent" />
        </div>
        <div className="h-10 w-40 animate-pulse rounded bg-accent" />
      </div>

      {/* Quick link */}
      <div className="mt-4 h-4 w-52 animate-pulse rounded bg-accent" />

      {/* Workspace cards grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
