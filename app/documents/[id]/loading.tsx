import { Skeleton } from '@/components/ui/skeleton';

/**
 * Segment-local loading skeleton for `/documents/[id]` — mirrors the
 * sibling `/documents/[id]/diff/loading.tsx` `Skeleton`-component shape
 * and approximates this page's five composed sections (provenance,
 * version chain, citations, derived pairs, related records) so the
 * streamed fallback reads as this page's own shell rather than a generic
 * placeholder. Gives the route its own Suspense boundary instead of
 * inheriting the root `app/loading.tsx` one.
 */
export default function SourceDocumentDetailLoading() {
  return (
    <div
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading document"
    >
      <span className="sr-only">Loading document...</span>

      {/* Back link skeleton */}
      <Skeleton className="h-4 w-28" />

      {/* Header skeleton */}
      <Skeleton className="mt-6 h-8 w-3/4" />

      {/* Composed sections skeleton (provenance, version chain, citations,
          derived pairs, related records) */}
      <div className="mt-6 space-y-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-6">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
