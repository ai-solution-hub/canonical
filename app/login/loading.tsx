export default function LoginLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background via-background to-accent/40 px-4"
      role="status"
      aria-label="Loading sign-in"
    >
      <span className="sr-only">Loading sign-in...</span>
      <div>
        {/* Brand heading skeleton */}
        <div className="mb-8 text-center">
          <div className="mx-auto h-7 w-40 animate-pulse rounded-md bg-accent" />
        </div>

        {/* Card skeleton matching login form */}
        <div className="w-full max-w-md rounded-lg border bg-card p-8">
          {/* Email input skeleton */}
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 h-4 w-16 animate-pulse rounded bg-accent" />
              <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
            </div>

            {/* Continue button skeleton */}
            <div className="h-10 w-full animate-pulse rounded-md bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
