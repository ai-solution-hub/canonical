import { Skeleton } from '@/components/ui/skeleton';

/**
 * Segment-local loading.tsx for `/documents/[id]` (ID-135 {135.29} spike).
 *
 * Follows the sibling `/documents/[id]/diff/loading.tsx` shape/skeleton
 * convention (same `[id]` segment, `Skeleton` component). Shape loosely
 * mirrors `SourceDocumentDetailClient`'s five composed sections (header +
 * provenance + version chain + citations + derived pairs/related records)
 * so the streamed skeleton reads as this page's own shell, not a generic
 * placeholder.
 *
 * Purpose: give this route its own Suspense boundary instead of inheriting
 * the root `app/loading.tsx` one — the candidate fix tested by the
 * {135.29} spike for the {135.27} transient duplicate-provenance-section
 * DOM race (see that subtask's journal for the instrumented verdict).
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
