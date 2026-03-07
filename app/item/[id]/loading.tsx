export default function ItemDetailLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Back button skeleton */}
      <div className="mb-6 h-9 w-20 animate-pulse rounded-md bg-accent" />

      {/* Title skeleton */}
      <div className="h-8 w-3/4 animate-pulse rounded-md bg-accent" />
      <div className="mt-2 h-8 w-1/2 animate-pulse rounded-md bg-accent" />

      {/* Meta row skeleton */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="h-6 w-28 animate-pulse rounded-full bg-accent" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-accent" />
        <div className="h-5 w-24 animate-pulse rounded bg-accent" />
        <div className="h-5 w-28 animate-pulse rounded bg-accent" />
      </div>

      {/* Thumbnail / hero image skeleton */}
      <div className="mt-6 aspect-video w-full animate-pulse rounded-lg bg-accent" />

      {/* Summary tabs skeleton */}
      <div className="mt-6 space-y-3">
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded-md bg-accent" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-accent" />
          <div className="h-8 w-24 animate-pulse rounded-md bg-accent" />
        </div>
        <div className="h-4 w-full animate-pulse rounded bg-accent" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-accent" />
        <div className="h-4 w-4/6 animate-pulse rounded bg-accent" />
      </div>

      {/* Content body skeleton */}
      <div className="mt-8 space-y-3">
        <div className="h-4 w-full animate-pulse rounded bg-accent" />
        <div className="h-4 w-full animate-pulse rounded bg-accent" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-accent" />
        <div className="h-4 w-full animate-pulse rounded bg-accent" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
        <div className="h-4 w-full animate-pulse rounded bg-accent" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-accent" />
      </div>

      {/* Keywords skeleton */}
      <div className="mt-8">
        <div className="mb-3 h-5 w-24 animate-pulse rounded bg-accent" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-6 animate-pulse rounded-full bg-accent"
              style={{ width: `${60 + i * 12}px` }}
            />
          ))}
        </div>
      </div>

      {/* Related items skeleton */}
      <div className="mt-12">
        <div className="mb-4 h-5 w-32 animate-pulse rounded bg-accent" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
            >
              <div className="aspect-video w-full animate-pulse rounded-md bg-accent" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
