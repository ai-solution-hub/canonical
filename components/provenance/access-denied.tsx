import Link from 'next/link';

export function AccessDenied() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center justify-center rounded-lg border bg-muted px-6 py-16 text-center"
    >
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        Admin access required
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The Provenance dashboard is restricted to administrators.
      </p>
      <Link
        href="/settings"
        className="inline-flex items-center rounded-md border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Return to settings
      </Link>
    </div>
  );
}
