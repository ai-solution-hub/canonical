/**
 * Cadence-renewal helper used by the governance approve handlers.
 *
 * Both `POST /api/governance/review` (action=`approve`) and the MCP
 * `review_governance_item` tool (action=`approve`) call this when an item is
 * approved: if the item has `review_cadence_days` populated, the next review
 * date is advanced to `GREATEST(currentNextReviewDate, today) + cadenceDays`.
 *
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md §6.5 + §6.5.1 + §6.9 AC8
 * Plan:  docs/plans/§5.5-phase-2-cron-plan.md T2
 *
 * Pure function — easy to unit-test, no Supabase or environment dependencies.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Compute the next review date for a content item being approved.
 *
 * @param currentNextReviewDate - the item's current `next_review_date`
 *   (`YYYY-MM-DD` ISO date string) or `null` if not previously set.
 * @param reviewCadenceDays - the item's `review_cadence_days` cadence (1..1095
 *   per Phase 1 DB CHECK) or `null` if no cadence is configured.
 * @param today - the reference "today" date — defaults to `new Date()`. Tests
 *   pin this for determinism.
 *
 * @returns
 * - `null` when `reviewCadenceDays` is `null` (no cadence configured → don't
 *   touch `next_review_date` at all). Callers should spread this into the
 *   update payload conditionally:
 *   ```ts
 *   ...(nextReviewDate && { next_review_date: nextReviewDate })
 *   ```
 * - Otherwise: `GREATEST(currentNextReviewDate, today) + reviewCadenceDays` as
 *   a `YYYY-MM-DD` ISO date string.
 *
 * Defensive coercion: if `currentNextReviewDate` parses to NaN (malformed
 * input — shouldn't happen given Zod gates at PATCH time), the helper falls
 * back to `today` rather than propagating Invalid Date through the formula.
 */
export function computeNextReviewDate(
  currentNextReviewDate: string | null,
  reviewCadenceDays: number | null,
  today: Date = new Date(),
): string | null {
  if (reviewCadenceDays === null) return null;

  const todayMs = today.getTime();

  let baseMs: number;
  if (currentNextReviewDate === null) {
    baseMs = todayMs;
  } else {
    const currentMs = new Date(currentNextReviewDate).getTime();
    baseMs = Number.isFinite(currentMs)
      ? Math.max(currentMs, todayMs)
      : todayMs;
  }

  const nextMs = baseMs + reviewCadenceDays * MS_PER_DAY;
  return new Date(nextMs).toISOString().slice(0, 10);
}
