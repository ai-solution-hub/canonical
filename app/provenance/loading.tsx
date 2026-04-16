export default function ProvenanceLoading() {
  return (
    <div
      role="status"
      aria-label="Loading provenance"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
    >
      <span className="sr-only">Loading provenance...</span>

      {/* Header skeleton */}
      <div className="mb-6 flex items-center gap-3">
        <div className="size-6 animate-pulse rounded bg-accent" />
        <div className="flex flex-col gap-1">
          <div className="h-6 w-32 animate-pulse rounded bg-accent" />
          <div className="h-4 w-56 animate-pulse rounded bg-accent" />
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="mb-6 flex gap-2">
        <div className="h-9 w-20 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-28 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-16 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-14 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-20 animate-pulse rounded-md bg-accent" />
      </div>

      {/* Content skeleton */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="h-5 w-48 animate-pulse rounded bg-accent" />
          <div className="mt-4 space-y-3">
            <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-10 w-3/4 animate-pulse rounded-md bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
