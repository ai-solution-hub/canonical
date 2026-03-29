export default function GuideDetailLoading() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading guide"
    >
      <span className="sr-only">Loading guide...</span>

      {/* Back link + title + badges */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-accent" />
      </div>
      <div className="mt-3 h-7 w-72 animate-pulse rounded-md bg-accent" />
      <div className="mt-2 flex gap-2">
        <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-accent" />
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-accent" />

      {/* Split layout: main content + sidebar */}
      <div className="mt-6 flex gap-6">
        {/* Main content sections */}
        <div className="min-w-0 flex-1 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="h-5 w-40 animate-pulse rounded bg-accent" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-accent" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-accent" />
                <div className="h-3 w-4/6 animate-pulse rounded bg-accent" />
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <div className="hidden w-64 shrink-0 space-y-4 lg:block">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="h-4 w-28 animate-pulse rounded bg-accent" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-8 w-full animate-pulse rounded-md bg-accent" />
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="h-4 w-20 animate-pulse rounded bg-accent" />
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-accent" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
