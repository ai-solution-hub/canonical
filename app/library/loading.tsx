export default function LibraryLoading() {
  return (
    <div role="status" aria-label="Loading Q&A library" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <span className="sr-only">Loading Q&amp;A library...</span>

      {/* Header: title + search input */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="h-8 w-40 animate-pulse rounded bg-accent" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-accent" />
        </div>
        <div className="h-10 w-64 animate-pulse rounded bg-accent" />
      </div>
      {/* Filter bar */}
      <div className="mt-6 mb-4 flex gap-3">
        <div className="h-8 w-24 animate-pulse rounded bg-accent" />
        <div className="h-8 w-24 animate-pulse rounded bg-accent" />
        <div className="h-8 w-24 animate-pulse rounded bg-accent" />
      </div>
      {/* Q&A row list */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
