import { CheckCircle2 } from 'lucide-react';

/**
 * Empty-state panel for the admin dedup queue.
 *
 * Rendered by {@link ContentDedupQueueClient} when the queue has zero
 * `suspected_duplicate` rows. Per §1.7 spec §6.3, this is a friendly
 * "all clear" surface that explains *when* the queue populates so the
 * admin understands silence is normal pre-launch.
 */
export function ContentDedupEmptyState() {
  return (
    <section
      role="region"
      aria-labelledby="dedup-empty-heading"
      className="rounded-lg border border-border bg-card p-8 text-center"
    >
      <CheckCircle2
        className="mx-auto size-10 text-status-success"
        aria-hidden="true"
      />
      <h2
        id="dedup-empty-heading"
        className="mt-4 text-base font-semibold text-foreground"
      >
        No suspected duplicates pending review.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        This queue surfaces rows soft-blocked by the exact-hash dedup gate. It
        will populate when an admin or pipeline re-uploads byte-identical
        content.
      </p>
    </section>
  );
}
