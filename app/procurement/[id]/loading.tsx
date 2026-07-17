export default function ProcurementDetailLoading() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading procurement details"
    >
      <span className="sr-only">Loading procurement details...</span>

      {/* Back button + title */}
      <div className="flex items-center gap-3">
        <div className="h-4 w-24 animate-pulse rounded bg-accent" />
      </div>
      <div className="mt-4 h-7 w-64 animate-pulse rounded-md bg-accent" />

      {/* Status stepper */}
      <div className="mt-4 h-8 w-full animate-pulse rounded-lg bg-accent" />

      {/* Tab bar */}
      <div className="mt-6 flex gap-2">
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-28 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
      </div>

      {/* Content area */}
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border bg-card p-4"
          >
            <div className="h-5 w-5 animate-pulse rounded bg-accent" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
            </div>
            <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
