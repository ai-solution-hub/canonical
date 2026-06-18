/**
 * Publication-lifecycle transition helper.
 *
 * Single source of truth for the §3.2 transition matrix and §3.4 role-gate
 * matrix that govern `content_items.publication_status`. Consumed by:
 *
 * - PATCH `/api/items/[id]` (T6) when `field='publication_status'`
 * - MCP `update_publication_status` tool (T7)
 *
 * Pure TypeScript — no Supabase calls, no environment dependencies. Easy to
 * unit-test and to audit against the SQL CHECK enum on the production
 * project.
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §3.2, §3.4, §8.3
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T5
 *
 * Non-mutating: `applyTransitionSideEffects` returns a new object; the input
 * `basePayload` is never modified.
 */

/**
 * The four publication-status values currently enforced by the SQL CHECK
 * constraint on `content_items.publication_status` (locked NOT NULL +
 * DEFAULT 'published' in migration `20260427141626…`).
 *
 * Order matches the SQL CHECK array verbatim. The
 * `publication-transitions.test.ts` drift guard pins this against the
 * canonical fixture so a CHECK widening in PG without a TS update fails
 * loudly (per CLAUDE.md `feedback_check_constraint_app_enum_drift`).
 */
export const VALID_PUBLICATION_STATUSES = [
  'draft',
  'in_review',
  'published',
  'archived',
] as const;

export type PublicationStatus = (typeof VALID_PUBLICATION_STATUSES)[number];

/**
 * The three application roles. Mirrors `get_user_role()` return values; the
 * canonical type source is `Enums<'user_role'>` off
 * `@/supabase/types/database.types` (see CLAUDE.md "TypeScript conventions").
 * Sourced fresh from `auth.success.role` at the route handler — never trust
 * client-side claims.
 */
export type UserRole = 'admin' | 'editor' | 'viewer';

/**
 * §3.2 transition table intersected with §3.4 role-gate matrix.
 *
 * Encodes ONLY ALLOWED transitions. The four spec-disallowed transitions per
 * §3.2 ("Disallowed transitions") are absent from every role's array:
 *
 * - `'draft' → 'archived'` (drafts are deleted, not archived)
 * - `'in_review' → 'archived'` (must return to draft or publish first)
 * - `'archived' → 'in_review'` (must restore to draft, then resubmit)
 * - `'published' → 'in_review'` (no "send back to review without revision")
 *
 * `'in_review' → 'published'` for editor is allowed per §3.4 ("YES per §5.3").
 * The §5.3 publication-approval gate is enforced AT THE ROUTE LEVEL (separate
 * spec); this helper only encodes role-shape eligibility.
 *
 * Viewer rows are universally empty (read-only role).
 */
const TRANSITION_MATRIX: Readonly<
  Record<
    PublicationStatus,
    Readonly<Record<UserRole, readonly PublicationStatus[]>>
  >
> = {
  draft: {
    admin: ['in_review', 'published'],
    editor: ['in_review'],
    viewer: [],
  },
  in_review: {
    admin: ['published', 'draft'],
    editor: ['published', 'draft'],
    viewer: [],
  },
  published: {
    admin: ['archived', 'draft'],
    editor: [],
    viewer: [],
  },
  archived: {
    admin: ['published', 'draft'],
    editor: [],
    viewer: [],
  },
};

/**
 * Compute the allowed `newStatus` values for transitioning out of
 * `currentStatus` given the caller's `role`.
 *
 * @param currentStatus - the item's current `publication_status` (one of the
 *   four values in `VALID_PUBLICATION_STATUSES`).
 * @param role - the caller's role from `auth.success.role`.
 * @returns Readonly array of allowed `newStatus` values. Empty array means
 *   "no transition is allowed" — callers should respond with 409 Conflict
 *   (per spec §8.3) when the requested transition is not in the array,
 *   reserving 403 Forbidden for the role-fail wrap at the auth layer.
 *
 * AC mapping:
 * - AC3.1 — every spec-allowed transition appears in the right cell.
 * - AC3.2 — every spec-disallowed transition is absent from every cell.
 * - AC3.3 — `'draft' → 'in_review'` allowed for editor.
 * - AC3.4 — `'draft' → 'published'` allowed for admin only.
 * - AC3.5 — `'published' → 'archived'` allowed for admin only.
 * - AC3.6 — `'archived' → 'published'` allowed for admin only.
 */
export function computeAllowedTransitions(
  currentStatus: PublicationStatus,
  role: UserRole,
): readonly PublicationStatus[] {
  return TRANSITION_MATRIX[currentStatus][role];
}

/**
 * Side-effect payload extension type. The PATCH route writes the returned
 * object directly into `content_items` via supabase-js `.update(...)`.
 *
 * `archived_at` / `archived_by` / `archive_reason` keys are added ONLY for
 * transitions that mutate them per §3.2 — un-set keys mean "do not touch
 * this column" and are absent from the payload entirely.
 *
 * Un-archive paths set `archived_at: null` explicitly (clearing the column)
 * but DELIBERATELY OMIT `archived_by` + `archive_reason` to preserve the
 * audit trail of why/who archived (per spec §3.2 + D-9 archived metadata
 * retention rationale).
 */
/** @public */
export type SideEffectPayload = {
  publication_status: PublicationStatus;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
};

/**
 * Assemble the side-effect payload for a publication-status transition per
 * the §3.2 mutation table.
 *
 * Three behaviour classes:
 *
 * 1. `'published' → 'archived'`: stamps `archived_at = NOW()`,
 *    `archived_by = userId`, and `archive_reason = archiveReason` if
 *    provided (else the key is absent — no overwrite).
 * 2. `'archived' → {published | draft | in_review}` (un-archive paths):
 *    explicitly sets `archived_at = null`. DELIBERATELY does NOT touch
 *    `archived_by` or `archive_reason` — those are preserved per spec §3.2
 *    so the audit trail of why/who archived survives the un-archive.
 * 3. All other transitions: returns `basePayload` extended with
 *    `publication_status: toState` and no archive metadata mutation.
 *
 * Note that `'archived' → 'in_review'` is a §3.2 disallowed transition;
 * `computeAllowedTransitions` will never return `'in_review'` for an
 * `'archived'` row, so this helper would only see that pair if a caller
 * bypassed the gate. We still include it in the un-archive class so the
 * function is total over the (PublicationStatus × PublicationStatus) input
 * space — the gate is the single owner of "what's allowed to call us".
 *
 * Non-mutating: returns a new object; `basePayload` is never modified.
 *
 * @param basePayload - caller-provided payload that ALREADY contains
 *   `publication_status` (typically also `updated_by`, possibly other
 *   fields like `updated_at` set by upstream middleware). The returned
 *   object spreads ALL keys from `basePayload`, then overlays
 *   `publication_status: toState` + any archive metadata mutations.
 * @param fromState - the item's current `publication_status` (read fresh
 *   from DB at the route handler before this call).
 * @param toState - the requested `newStatus`.
 * @param userId - the calling user's id (UUID). Stamped into `archived_by`
 *   on archive transitions.
 * @param archiveReason - optional human-readable reason for archive (max
 *   500 chars per Zod schema). Only stamped on `published → archived`.
 */
export function applyTransitionSideEffects(
  basePayload: { publication_status: PublicationStatus } & Record<
    string,
    unknown
  >,
  fromState: PublicationStatus,
  toState: PublicationStatus,
  userId: string,
  archiveReason?: string,
): SideEffectPayload & Record<string, unknown> {
  // Start from a copy of the input so we never mutate the caller's object.
  const next: SideEffectPayload & Record<string, unknown> = {
    ...basePayload,
    publication_status: toState,
  };

  // Archive transition: stamp archived_at + archived_by + (optional) reason.
  if (fromState === 'published' && toState === 'archived') {
    next.archived_at = new Date().toISOString();
    next.archived_by = userId;
    if (archiveReason !== undefined) {
      next.archive_reason = archiveReason;
    }
    return next;
  }

  // Un-archive transitions: clear archived_at, PRESERVE archived_by +
  // archive_reason for audit trail.
  if (
    fromState === 'archived' &&
    (toState === 'published' || toState === 'draft' || toState === 'in_review')
  ) {
    next.archived_at = null;
    return next;
  }

  // All other transitions: no archive metadata mutation.
  return next;
}
