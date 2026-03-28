export default function WorkspacesLoading() {
  return (
    <div role="status" aria-label="Loading workspaces" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header: title + button */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="h-8 w-40 animate-pulse rounded bg-accent" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-accent" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded bg-accent" />
      </div>

      {/* Section heading */}
      <div className="mt-6 mb-4 h-4 w-44 animate-pulse rounded bg-accent" />

      {/* Workspace cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
