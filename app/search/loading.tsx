export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Search bar skeleton */}
      <div className="mb-8 h-9 w-full max-w-sm animate-pulse rounded-md bg-accent" />

      {/* Results header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <div className="h-5 w-48 animate-pulse rounded bg-accent" />
        <div className="flex items-center gap-1">
          <div className="size-9 animate-pulse rounded-md bg-accent" />
          <div className="size-9 animate-pulse rounded-md bg-accent" />
        </div>
      </div>

      {/* Results grid skeleton */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-lg border border-border"
          >
            <div className="aspect-video w-full animate-pulse bg-accent" />
            <div className="flex flex-col gap-2 p-3">
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-full animate-pulse rounded bg-accent" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-accent" />
              <div className="mt-auto flex flex-col gap-1.5 pt-2">
                <div className="h-5 w-24 animate-pulse rounded-full bg-accent" />
                <div className="h-3 w-20 animate-pulse rounded bg-accent" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
