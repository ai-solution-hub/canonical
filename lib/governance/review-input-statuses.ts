/**
 * Allowed input statuses for the governance review action handlers.
 *
 * The `POST /api/governance/review` route and the `review_governance_item`
 * MCP tool both inspect `content_items.governance_review_status` BEFORE
 * processing an `approve` / `request_changes` / `revert` action and reject
 * any item whose status is not in this allow-list.
 *
 * Pre-§5.5 the guard was a literal `!== 'pending'` check. §5.5 Phase 1 adds
 * `'review_overdue'` to the allow-list so that the Phase 2 cron-driven
 * overdue path can be approved/renewed via the same handlers — without it,
 * the handlers would 4xx-reject every overdue item.
 *
 * Spec: docs/specs/p0-document-control-lifecycle-spec.md §6.5.1
 * Plan:  docs/plans/§5.5-phase-1-schema-plan.md T5
 */
export const ALLOWED_REVIEW_INPUT_STATUSES = [
  'pending',
  'review_overdue',
] as const;

export type AllowedReviewInputStatus =
  (typeof ALLOWED_REVIEW_INPUT_STATUSES)[number];
