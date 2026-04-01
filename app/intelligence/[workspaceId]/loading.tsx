export default function WorkspaceLoading() {
  return (
    <div role="status" aria-label="Loading workspace">
      <span className="sr-only">Loading workspace...</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
