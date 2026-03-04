export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Header skeleton */}
      <div className="h-7 w-32 animate-pulse rounded-md bg-accent" />

      {/* Tabs skeleton */}
      <div className="mt-6 flex gap-4 border-b border-border pb-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded bg-accent" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="mt-6 space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="h-5 w-40 animate-pulse rounded bg-accent" />
          <div className="mt-4 space-y-3">
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-9 w-2/3 animate-pulse rounded-md bg-accent" />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="h-5 w-48 animate-pulse rounded bg-accent" />
          <div className="mt-4 space-y-3">
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-9 w-1/2 animate-pulse rounded-md bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
