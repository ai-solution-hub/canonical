export default function BatchCreateLoading() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading batch creation"
    >
      <span className="sr-only">Loading batch creation...</span>

      {/* Title skeleton */}
      <div className="h-7 w-56 animate-pulse rounded-md bg-accent" />
      <div className="mt-1.5 h-4 w-80 animate-pulse rounded bg-accent" />

      {/* Textarea placeholder */}
      <div className="mt-6 h-48 w-full animate-pulse rounded-md border bg-accent" />

      {/* Help text */}
      <div className="mt-2 h-3 w-64 animate-pulse rounded bg-accent" />

      {/* Action button area */}
      <div className="mt-6 flex items-center justify-between">
        <div className="h-4 w-32 animate-pulse rounded bg-accent" />
        <div className="h-10 w-32 animate-pulse rounded-md bg-accent" />
      </div>
    </div>
  );
}
