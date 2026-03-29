export default function NewItemLoading() {
  return (
    <div
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading content creation"
    >
      <span className="sr-only">Loading content creation...</span>

      {/* Tab triggers skeleton */}
      <div className="flex gap-2">
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-28 animate-pulse rounded-md bg-accent" />
        <div className="h-9 w-24 animate-pulse rounded-md bg-accent" />
      </div>

      {/* Form area skeleton */}
      <div className="mt-6 space-y-4">
        {/* Title input */}
        <div>
          <div className="mb-1.5 h-4 w-12 animate-pulse rounded bg-accent" />
          <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
        </div>

        {/* Type and domain selects */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 h-4 w-16 animate-pulse rounded bg-accent" />
            <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
          </div>
          <div>
            <div className="mb-1.5 h-4 w-20 animate-pulse rounded bg-accent" />
            <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
          </div>
        </div>

        {/* Content textarea */}
        <div>
          <div className="mb-1.5 h-4 w-16 animate-pulse rounded bg-accent" />
          <div className="h-48 w-full animate-pulse rounded-md bg-accent" />
        </div>

        {/* Submit button */}
        <div className="flex justify-end">
          <div className="h-10 w-28 animate-pulse rounded-md bg-accent" />
        </div>
      </div>
    </div>
  );
}
