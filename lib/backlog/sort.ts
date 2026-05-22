/**
 * sort.ts — Pure deterministic backlog item ordering (TECH §3.3).
 *
 * Verifies PRODUCT inv 4 (within-priority deterministic ordering) at the
 * helper boundary. Backlog rendering surfaces (CLI tooling, web UI) call this
 * helper to project the canonical sort order without re-implementing it.
 *
 * Sort keys, in order:
 *   1. Priority tier — MoSCoW (must < should < could < future) ahead of Ranked
 *      (high < medium < low) ahead of Trigger.
 *   2. Rank ascending. Null sorts last via `Number.MAX_SAFE_INTEGER` fallback.
 *   3. Id ascending, parsed as integer (bare-digit canonical form per
 *      PRODUCT inv 37) so `'9'` sorts before `'10'`.
 *
 * Pure — returns a new array; never mutates the input.
 *
 * Per Subtask 30.7 (PRODUCT inv 4 + TECH §3.3).
 */

import type { BacklogItem } from '@/lib/validation/backlog-schema';
import type { Priority } from '@/lib/validation/work-status';

const priorityOrder: Record<Priority, number> = {
  must: 0,
  should: 1,
  could: 2,
  future: 3,
  high: 4,
  medium: 5,
  low: 6,
  trigger: 7,
};

export function sortBacklogItems(items: BacklogItem[]): BacklogItem[] {
  return [...items].sort((a, b) => {
    const pDelta = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDelta !== 0) return pDelta;
    const rA = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rB = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (rA !== rB) return rA - rB;
    return parseInt(a.id, 10) - parseInt(b.id, 10);
  });
}
