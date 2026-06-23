/**
 * Shared bid utility functions.
 *
 * Extracted from bid-list-card.tsx so the same logic can be reused
 * across the bid listing cards and the bid detail header.
 */

/** @public */
export interface DeadlineProximity {
  /** Human-readable label, e.g. "3 days left" or "Overdue" */
  label: string;
  /** True when the deadline has already passed */
  isOverdue: boolean;
  /** Signed day count: negative = overdue, 0 = today, positive = future */
  daysLeft: number;
}

/**
 * Calculate how close (or past) a deadline is.
 *
 * Returns a `DeadlineProximity` object when the deadline is overdue or
 * within 7 days, otherwise `null` (no urgency to communicate).
 */
export function getDeadlineProximity(
  deadline: string | null | undefined,
): DeadlineProximity | null {
  if (!deadline) return null;

  const deadlineDate = new Date(deadline);
  const now = new Date();
  deadlineDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffMs = deadlineDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: 'Overdue', isOverdue: true, daysLeft: diffDays };
  }

  if (diffDays === 0) {
    return { label: 'Due today', isOverdue: false, daysLeft: 0 };
  }

  if (diffDays <= 7) {
    return {
      label: `${diffDays} day${diffDays !== 1 ? 's' : ''} left`,
      isOverdue: false,
      daysLeft: diffDays,
    };
  }

  return null;
}
