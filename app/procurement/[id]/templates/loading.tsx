export default function TemplateCompletionLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading template completion"
    >
      <span className="sr-only">Loading template completion...</span>

      {/* Back button + heading */}
      <div className="flex items-center gap-3">
        <div className="h-4 w-20 animate-pulse rounded bg-accent" />
      </div>
      <div className="mt-3 h-7 w-52 animate-pulse rounded-md bg-accent" />

      {/* Template selector cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border bg-card p-4"
          >
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded bg-accent" />
              <div className="h-5 w-32 animate-pulse rounded bg-accent" />
            </div>
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-accent" />
            <div className="mt-2 h-8 w-24 animate-pulse rounded-md bg-accent" />
          </div>
        ))}
      </div>

      {/* Upload area skeleton */}
      <div className="mt-6 h-32 animate-pulse rounded-lg border-2 border-dashed border-border bg-accent/50" />
    </div>
  );
}
