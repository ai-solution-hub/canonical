export default function BidSessionLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading drafting session"
    >
      <span className="sr-only">Loading drafting session...</span>

      {/* Back link + title */}
      <div className="flex items-center gap-3">
        <div className="h-4 w-20 animate-pulse rounded bg-accent" />
      </div>
      <div className="mt-3 h-7 w-56 animate-pulse rounded-md bg-accent" />

      {/* Split layout: sidebar + main editor */}
      <div className="mt-6 flex gap-6">
        {/* Sidebar: question navigator */}
        <div className="hidden w-64 shrink-0 space-y-2 lg:block">
          <div className="h-5 w-32 animate-pulse rounded bg-accent" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>

        {/* Main: editor area */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Question header */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-accent" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-accent" />
          </div>

          {/* Editor area */}
          <div className="h-64 animate-pulse rounded-lg border border-border bg-accent" />

          {/* Action bar */}
          <div className="flex items-center justify-between">
            <div className="h-4 w-20 animate-pulse rounded bg-accent" />
            <div className="flex gap-2">
              <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
              <div className="h-9 w-28 animate-pulse rounded-md bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
