import { CheckCircle2 } from 'lucide-react';

interface QaDedupEmptyStateProps {
  /** The active status filter — surfaced so the curator understands the scope. */
  status: string;
}

/**
 * Empty-state panel for the ID-120 {120.8} cross-workspace Q&A dedup curator
 * surface (TECH P-4 / INV-19).
 *
 * Rendered when the proposal queue returns zero rows at the active status
 * filter. Names the active filter so the curator understands why the list is
 * empty (e.g. "No pending duplicate proposals" vs the resolved tabs).
 */
export function QaDedupEmptyState({ status }: QaDedupEmptyStateProps) {
  const label = status === 'all' ? '' : `${status} `;
  return (
    <section
      role="region"
      aria-labelledby="qa-dedup-empty-heading"
      className="rounded-lg border border-border bg-card p-8 text-center"
    >
      <CheckCircle2
        className="mx-auto size-10 text-status-success"
        aria-hidden="true"
      />
      <h2
        id="qa-dedup-empty-heading"
        className="mt-4 text-base font-semibold text-foreground"
      >
        No {label}duplicate proposals.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        The walk-time proposer surfaces likely-duplicate Q&amp;A pairs across
        the organisation&rsquo;s workspaces and forms. When it finds candidates,
        they appear here for review.
      </p>
    </section>
  );
}
