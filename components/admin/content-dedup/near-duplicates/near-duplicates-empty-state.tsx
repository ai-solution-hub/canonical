import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

interface NearDuplicatesEmptyStateProps {
  threshold: number;
}

/**
 * Empty-state panel for the §1.9 near-duplicate dashboard list view.
 *
 * Rendered when `find_duplicate_pairs` returns zero pairs at the chosen
 * threshold (or after the dedup-status filter excludes all of them).
 * Surfaces the active threshold so the admin understands why the list
 * is empty, and points back to §1.7 for exact-hash review.
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.3.
 */
export function NearDuplicatesEmptyState({
  threshold,
}: NearDuplicatesEmptyStateProps) {
  return (
    <section
      role="region"
      aria-labelledby="near-dup-empty-heading"
      className="rounded-lg border border-border bg-card p-8 text-center"
    >
      <CheckCircle2
        className="mx-auto size-10 text-status-success"
        aria-hidden="true"
      />
      <h2
        id="near-dup-empty-heading"
        className="mt-4 text-base font-semibold text-foreground"
      >
        No near-duplicate pairs above threshold {threshold.toFixed(2)}.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Try lowering the threshold (slider above) to surface less-similar pairs,
        or clear the domain filter.
      </p>
      <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
        At threshold &ge; 0.95 the dashboard typically shows under 10 pairs for
        a healthy KB — high-volume periods (post-ingest waves) excepted.
      </p>
      <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">
        See also:{' '}
        <Link
          href="/admin/content-dedup"
          className="underline underline-offset-2 hover:text-foreground"
        >
          /admin/content-dedup
        </Link>{' '}
        (exact-hash review queue).
      </p>
    </section>
  );
}
