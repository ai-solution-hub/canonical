'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

/** Shared row classes — identical between the linked and unlinked variants. */
const ROW_CLASS =
  'relative flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3';

/**
 * Interactive descendants of a linked row must paint ABOVE the stretched
 * overlay link, or the overlay swallows their clicks. Text content
 * deliberately stays below it so clicking anywhere else still follows the row
 * link.
 */
export const ROW_ACTION_CLASS = 'relative z-20';

export interface EntitySummaryRowProps {
  /** Evidence-document href, or `null` when the entity has no linked document. */
  itemLink: string | null;
  /** Accessible name for the overlay link (it has no text of its own). */
  overlayLabel: string;
  children: ReactNode;
}

/**
 * A compliance-card list row that is wholly clickable without being an `<a>`.
 *
 * Both summary cards used to make the row itself the anchor (`<Link
 * role="listitem">` wrapping the whole card), which put the "Review"/"Renew"
 * link and the entity-edit button *inside* it. `<a>` is interactive content
 * and may not contain interactive content, so React logged `In HTML, <a>
 * cannot be a descendant of <a>. This will cause a hydration error.` on every
 * dashboard load carrying an expiring entity, and the nested control was not
 * reachable by keyboard/AT in the way its markup claimed. The nested anchor
 * also pointed at the *same* href as the row, so it added a duplicate
 * destination rather than a distinct one.
 *
 * The stretched-link pattern keeps the whole-row click target while leaving
 * the row a plain `<div>`: one absolutely-positioned overlay anchor, with the
 * real controls raised above it via `ROW_ACTION_CLASS`. The overlay carries
 * its own accessible name so it is never an unlabelled link.
 */
export function EntitySummaryRow({
  itemLink,
  overlayLabel,
  children,
}: EntitySummaryRowProps) {
  if (!itemLink) {
    return (
      <div className={ROW_CLASS} role="listitem">
        {children}
      </div>
    );
  }

  return (
    <div
      className={`${ROW_CLASS} transition-colors hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring/50`}
      role="listitem"
    >
      <Link
        href={itemLink}
        aria-label={overlayLabel}
        className="absolute inset-0 z-10 rounded-lg"
      />
      {children}
    </div>
  );
}
