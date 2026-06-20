import { Suspense } from 'react';
import { ReferenceContent } from './reference-content';

/**
 * `/reference` — reference browse/list + search + filters page (ID-111.10).
 *
 * A `Suspense` shell around the client `ReferenceContent` (which reads
 * `useSearchParams()` for URL-driven search/filter state — Next.js requires a
 * Suspense boundary above any `useSearchParams` consumer). Authenticated
 * surface: NOT added to `proxy.ts` publicRoutes (B-21) — an unauthenticated
 * request redirects to `/login` automatically.
 *
 * Spec: PRODUCT.md B-11..B-22; TECH.md Seam 1.
 */
export default function ReferencePage() {
  return (
    <Suspense fallback={<ReferencePageSkeleton />}>
      <ReferenceContent />
    </Suspense>
  );
}

function ReferencePageSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading references page"
    >
      <span className="sr-only">Loading references page...</span>
      <div className="h-7 w-48 animate-pulse rounded-md bg-accent" />
      <div className="mt-4 h-9 w-full animate-pulse rounded-md bg-accent" />
      <div
        className="mt-6 grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border bg-card p-3"
          >
            <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
