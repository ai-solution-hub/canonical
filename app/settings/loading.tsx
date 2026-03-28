export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading settings" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center gap-3">
        <div className="size-6 animate-pulse rounded bg-accent" />
        <div className="flex flex-col gap-1">
          <div className="h-6 w-24 animate-pulse rounded bg-accent" />
          <div className="h-4 w-48 animate-pulse rounded bg-accent" />
        </div>
      </div>

      <div className="flex gap-8">
        {/* Sidebar skeleton (hidden on mobile) */}
        <aside className="hidden w-[220px] shrink-0 md:block">
          <div className="flex flex-col gap-1">
            <div className="mb-1 h-3 w-16 animate-pulse rounded bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="my-2 border-t border-border" />
            <div className="mb-1 h-3 w-32 animate-pulse rounded bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="my-2 border-t border-border" />
            <div className="mb-1 h-3 w-14 animate-pulse rounded bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
            <div className="h-9 w-full animate-pulse rounded-md bg-accent" />
          </div>
        </aside>

        {/* Content skeleton */}
        <div className="min-w-0 flex-1 space-y-6">
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
    </div>
  );
}
